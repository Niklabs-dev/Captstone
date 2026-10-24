import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  parseCalendarDate,
  type CalendarDate,
} from '../audit/utils/business-day.util.js';
import { ROLE } from '../auth/constants/roles.constants.js';
import {
  canAccessStore,
  hasAnyRole,
} from '../auth/policies/store-access.policy.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StoresService } from '../stores/stores.service.js';
import { StorageService } from '../storage/storage.service.js';
import { ALLOWED_MIME_TYPES } from '../storage/types/storage.types.js';
import type { ListDocumentsQueryDto } from './dto/list-documents-query.dto.js';
import type { UploadDocumentDto } from './dto/upload-document.dto.js';
import {
  canReadDocument,
  canReadOthersDocuments,
} from './policies/document-access.policy.js';
import {
  DOCUMENT_SUBJECT_ROLES,
  UPLOADABLE_DOCUMENT_TYPES,
  type DocumentDeletionResponse,
  type DocumentDownload,
  type DocumentListResponse,
  type DocumentResponse,
  type DocumentVersionHistory,
  type DocumentVersionResponse,
  type IntegrityCheckResponse,
  type IntegrityStatus,
  type UploadedDocumentFile,
} from './types/documents.types.js';
import {
  computeDocumentDeadlines,
  formatDbDate,
  isRetentionExpired,
} from './utils/document-dates.util.js';
import { buildDownloadFileName } from './utils/download-name.util.js';
import { sanitizeFileName } from './utils/file-name.util.js';
import { maxUploadBytes } from './utils/upload-limits.util.js';

const VERSION_INCLUDE = {
  uploadedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.DocumentVersionInclude;

const DOCUMENT_INCLUDE = {
  documentType: { select: { code: true } },
  currentVersion: { include: VERSION_INCLUDE },
} satisfies Prisma.DocumentInclude;

type VersionWithRelations = Prisma.DocumentVersionGetPayload<{
  include: typeof VERSION_INCLUDE;
}>;

type DocumentWithRelations = Prisma.DocumentGetPayload<{
  include: typeof DOCUMENT_INCLUDE;
}>;

// Versión con los datos del documento que deciden el acceso y el nombre de
// descarga.
const READABLE_VERSION_INCLUDE = {
  document: {
    select: {
      title: true,
      storeId: true,
      subjectUserId: true,
      documentType: { select: { code: true } },
    },
  },
} satisfies Prisma.DocumentVersionInclude;

type ReadableVersion = Prisma.DocumentVersionGetPayload<{
  include: typeof READABLE_VERSION_INCLUDE;
}>;

const DOCUMENT_FORBIDDEN_MESSAGE = 'No tienes acceso a este documento';

// Solo los documentos laborales de este módulo: las liquidaciones (flujo del
// contador, con su propio estado de publicación) y los documentos del local
// no se consultan por aquí.
const LABOR_DOCUMENT_WHERE = {
  documentType: { code: { in: [...UPLOADABLE_DOCUMENT_TYPES] } },
} satisfies Prisma.DocumentWhereInput;

function toVersionResponse(
  version: VersionWithRelations,
): DocumentVersionResponse {
  return {
    id: version.id,
    number: version.versionNumber,
    fileName: version.fileName,
    mime: version.mimeType,
    size: Number(version.sizeBytes),
    sha256: version.sha256Hash,
    changeNote: version.changeNote,
    createdAt: version.uploadedAt,
    uploadedBy: `${version.uploadedBy.firstName} ${version.uploadedBy.lastName}`,
  };
}

// Motivo por el que un documento no puede eliminarse antes de su plazo de
// conservación (SPRINT-2-T07).
function retentionReason(retainUntil: string): string {
  return `El documento debe conservarse hasta el ${retainUntil} (art. 9 bis del Código del Trabajo)`;
}

function toDocumentResponse(document: DocumentWithRelations): DocumentResponse {
  const version = document.currentVersion;
  // La carga siempre deja un trabajador y una versión vigente; si faltan, el
  // documento no se creó por este flujo.
  if (!version || document.subjectUserId === null) {
    throw new Error(
      `El documento ${document.id} no tiene versión o trabajador`,
    );
  }
  const retainUntil = formatDbDate(document.retainUntil);
  const deletionBlocked = !isRetentionExpired(document.retainUntil, new Date());
  return {
    id: document.id,
    workerId: document.subjectUserId,
    storeId: document.storeId,
    type: document.documentType.code,
    title: document.title,
    issuedAt: document.issuedAt ? formatDbDate(document.issuedAt) : null,
    retainUntil,
    dtRegistrationDueAt: document.dtRegistrationDueAt
      ? formatDbDate(document.dtRegistrationDueAt)
      : null,
    deletionBlocked,
    deletionReason: deletionBlocked ? retentionReason(retainUntil) : null,
    createdAt: document.createdAt,
    latestVersion: toVersionResponse(version),
  };
}

// Gestor documental: carga de documentos laborales en la carpeta digital de
// un trabajador con versiones inmutables (SPRINT-2-T05), y su consulta,
// descarga y verificación de integridad (SPRINT-2-T06), y su eliminación
// solo vencido el plazo de conservación (SPRINT-2-T07).
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
  private readonly maxUploadBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly stores: StoresService,
    config: ConfigService,
  ) {
    this.maxUploadBytes = maxUploadBytes(
      config.get<string>('DOCUMENTS_MAX_SIZE_MB'),
    );
  }

  // Lista los documentos laborales con su versión vigente. Un trabajador o
  // supervisor solo obtiene los suyos; pedir los de otro responde 403.
  async list(
    query: ListDocumentsQueryDto,
    currentUser: AuthUser,
  ): Promise<DocumentListResponse> {
    let subjectUserId = query.workerId;
    if (!canReadOthersDocuments(currentUser)) {
      if (subjectUserId !== undefined && subjectUserId !== currentUser.id) {
        throw new ForbiddenException(
          'Solo puedes consultar tus propios documentos',
        );
      }
      subjectUserId = currentUser.id;
    }

    const documents = await this.prisma.document.findMany({
      where: {
        // Sin filtro de tipo: todos los tipos laborales de este módulo.
        documentType: {
          code: query.documentTypeCode ?? {
            in: [...UPLOADABLE_DOCUMENT_TYPES],
          },
        },
        // Siempre con trabajador titular y versión vigente.
        subjectUserId: subjectUserId ?? { not: null },
        currentVersionId: { not: null },
        storeId: query.storeId,
      },
      include: DOCUMENT_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });

    return {
      items: documents.map(toDocumentResponse),
      policy: {
        maxBytes: this.maxUploadBytes,
        allowedMimes: [...ALLOWED_MIME_TYPES],
        canUpload: hasAnyRole(currentUser, [ROLE.ADMINISTRADOR]),
      },
    };
  }

  // Historial completo de versiones, de la más nueva a la más antigua.
  async getVersionHistory(
    documentId: string,
    currentUser: AuthUser,
  ): Promise<DocumentVersionHistory> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ...LABOR_DOCUMENT_WHERE },
      include: {
        versions: {
          include: VERSION_INCLUDE,
          orderBy: { versionNumber: 'desc' },
        },
      },
    });
    if (!document || document.subjectUserId === null) {
      throw new NotFoundException('Documento no encontrado');
    }
    if (!canReadDocument(currentUser, document)) {
      throw new ForbiddenException(DOCUMENT_FORBIDDEN_MESSAGE);
    }
    return {
      documentId: document.id,
      workerId: document.subjectUserId,
      versions: document.versions.map(toVersionResponse),
    };
  }

  // Archivo de una versión con su nombre de descarga. Recalcula el hash: si
  // no coincide la descarga continúa, pero informa ALTERED para advertirlo.
  // Si el archivo no está en el almacenamiento, StorageService responde 404.
  async download(
    versionId: string,
    currentUser: AuthUser,
  ): Promise<DocumentDownload> {
    const version = await this.findReadableVersion(versionId, currentUser);
    const content = await this.storage.read(version.filePath);
    const integrity =
      this.storage.computeSha256(content) === version.sha256Hash
        ? 'VALID'
        : 'ALTERED';
    if (integrity === 'ALTERED') {
      this.logger.warn(
        `Descarga de la versión ${version.id} con integridad ALTERED`,
      );
    }
    return {
      content,
      fileName: buildDownloadFileName(
        version.document.documentType.code,
        version.document.title,
        version.versionNumber,
        version.mimeType,
      ),
      mimeType: version.mimeType,
      integrity,
      documentId: version.documentId,
      storeId: version.document.storeId,
    };
  }

  // Recalcula el SHA-256 del archivo guardado y lo compara con el registrado
  // al cargarlo. Un archivo faltante es un resultado (MISSING), no un error.
  async checkIntegrity(
    versionId: string,
    currentUser: AuthUser,
  ): Promise<IntegrityCheckResponse> {
    const version = await this.findReadableVersion(versionId, currentUser);
    let actualHash: string | null = null;
    try {
      actualHash = this.storage.computeSha256(
        await this.storage.read(version.filePath),
      );
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
    }
    const status: IntegrityStatus =
      actualHash === null
        ? 'MISSING'
        : actualHash === version.sha256Hash
          ? 'VALID'
          : 'ALTERED';
    if (status !== 'VALID') {
      this.logger.warn(
        `Verificación de la versión ${version.id}: integridad ${status}`,
      );
    }
    return {
      versionId: version.id,
      status,
      valid: status === 'VALID',
      expectedHash: version.sha256Hash,
      actualHash,
      checkedAt: new Date(),
    };
  }

  // Versión de un documento laboral que el usuario puede leer (404 si no
  // existe; 403 si es de otro trabajador y el usuario no es administrador).
  private async findReadableVersion(
    versionId: string,
    currentUser: AuthUser,
  ): Promise<ReadableVersion> {
    const version = await this.prisma.documentVersion.findFirst({
      where: { id: versionId, document: LABOR_DOCUMENT_WHERE },
      include: READABLE_VERSION_INCLUDE,
    });
    if (!version) {
      throw new NotFoundException('Versión no encontrada');
    }
    if (!canReadDocument(currentUser, version.document)) {
      throw new ForbiddenException(DOCUMENT_FORBIDDEN_MESSAGE);
    }
    return version;
  }

  // Sin documentId crea un documento nuevo (versión 1); con documentId agrega
  // una versión al documento existente. Las versiones anteriores no se tocan:
  // la base de datos rechaza modificarlas o eliminarlas (trigger).
  async upload(
    dto: UploadDocumentDto,
    file: UploadedDocumentFile | undefined,
    currentUser: AuthUser,
  ): Promise<DocumentResponse> {
    if (!file) {
      throw new BadRequestException(
        'Falta el archivo del documento (campo file)',
      );
    }

    const worker = await this.prisma.user.findUnique({
      where: { id: dto.workerId },
      include: { role: { select: { code: true } } },
    });
    if (!worker) {
      throw new NotFoundException('Trabajador no encontrado');
    }
    // Se admiten trabajadores desactivados: el finiquito se carga justamente
    // al terminar la relación laboral.
    const workerStoreId = worker.storeId;
    if (
      !(DOCUMENT_SUBJECT_ROLES as readonly string[]).includes(
        worker.role.code,
      ) ||
      workerStoreId === null
    ) {
      throw new BadRequestException(
        'El usuario indicado no es un trabajador con local asignado',
      );
    }
    await this.stores.assertActive(workerStoreId);

    const documentType = await this.prisma.documentType.findUnique({
      where: { code: dto.documentTypeCode },
    });
    if (!documentType || !documentType.isActive) {
      throw new BadRequestException(
        'El tipo de documento no existe o está inactivo',
      );
    }

    // Validaciones previas a guardar el archivo, para no dejarlo huérfano en
    // disco si la carga se rechaza.
    let title = '';
    let issuedAt: CalendarDate | null = null;
    if (dto.documentId !== undefined) {
      const existing = await this.prisma.document.findUnique({
        where: { id: dto.documentId },
      });
      if (!existing) {
        throw new NotFoundException('Documento no encontrado');
      }
      if (
        existing.subjectUserId !== worker.id ||
        existing.documentTypeId !== documentType.id
      ) {
        throw new BadRequestException(
          'El documento indicado no pertenece a ese trabajador o no es de ese tipo',
        );
      }
      await this.stores.assertActive(existing.storeId);
    } else {
      if (dto.title === undefined) {
        throw new BadRequestException(
          'title es obligatorio para un documento nuevo',
        );
      }
      title = dto.title;
      if (dto.issuedAt !== undefined) {
        issuedAt = parseCalendarDate(dto.issuedAt);
        if (!issuedAt) {
          throw new BadRequestException('issuedAt no es una fecha válida');
        }
      }
    }

    await this.ensureNotRegistered(this.storage.computeSha256(file.buffer));
    const stored = await this.storage.save(file.buffer, file.mimetype);

    try {
      const document = await this.prisma.$transaction(async (tx) => {
        let documentId: string;
        let versionNumber: number;
        if (dto.documentId !== undefined) {
          // Bloquea la fila del documento hasta el fin de la transacción: dos
          // cargas simultáneas se serializan y no compiten por el mismo número.
          await tx.$queryRaw`SELECT id FROM documents WHERE id = ${dto.documentId}::uuid FOR UPDATE`;
          const last = await tx.documentVersion.aggregate({
            where: { documentId: dto.documentId },
            _max: { versionNumber: true },
          });
          documentId = dto.documentId;
          versionNumber = (last._max.versionNumber ?? 0) + 1;
        } else {
          const deadlines = computeDocumentDeadlines({
            issuedAt,
            uploadedAt: new Date(),
            retentionYears: documentType.retentionYears,
            requiresDtRegistration: documentType.requiresDtRegistration,
          });
          const created = await tx.document.create({
            data: {
              title,
              ...deadlines,
              storeId: workerStoreId,
              subjectUserId: worker.id,
              documentTypeId: documentType.id,
              createdById: currentUser.id,
            },
          });
          documentId = created.id;
          versionNumber = 1;
        }

        const version = await tx.documentVersion.create({
          data: {
            documentId,
            versionNumber,
            fileName: sanitizeFileName(file.originalname),
            filePath: stored.relativePath,
            mimeType: stored.mimeType,
            sizeBytes: stored.sizeBytes,
            sha256Hash: stored.sha256Hash,
            changeNote: dto.changeNote,
            uploadedById: currentUser.id,
          },
        });
        return tx.document.update({
          where: { id: documentId },
          data: { currentVersionId: version.id },
          include: DOCUMENT_INCLUDE,
        });
      });
      return toDocumentResponse(document);
    } catch (error) {
      // Mismo archivo cargado en paralelo: lo detecta el índice único de
      // sha256_hash. El archivo físico queda sin registro (su nombre no
      // contiene datos personales).
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Este archivo ya está registrado');
      }
      throw error;
    }
  }

  // Elimina un documento laboral con todas sus versiones y archivos, solo si
  // venció su plazo de conservación (art. 9 bis CT): antes responde 409 y no
  // toca nada. La base de datos aplica la misma regla con triggers
  // (migración bloqueo_eliminacion_documentos).
  async remove(
    documentId: string,
    currentUser: AuthUser,
  ): Promise<DocumentDeletionResponse> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ...LABOR_DOCUMENT_WHERE },
      include: { versions: { select: { filePath: true } } },
    });
    if (!document) {
      throw new NotFoundException('Documento no encontrado');
    }
    if (!canAccessStore(currentUser, document.storeId)) {
      throw new ForbiddenException(DOCUMENT_FORBIDDEN_MESSAGE);
    }
    const retainUntil = formatDbDate(document.retainUntil);
    if (!isRetentionExpired(document.retainUntil, new Date())) {
      throw new ConflictException(
        `${retentionReason(retainUntil)}: no se puede eliminar antes`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // La versión vigente apunta al documento y viceversa: se suelta primero.
      await tx.document.update({
        where: { id: documentId },
        data: { currentVersionId: null },
      });
      await tx.documentVersion.deleteMany({ where: { documentId } });
      await tx.document.delete({ where: { id: documentId } });
    });

    // Los archivos se eliminan después de confirmar la transacción: si
    // fallara, la base de datos seguiría apuntando a archivos inexistentes.
    // Un archivo que no se pudo eliminar queda huérfano (su nombre no contiene
    // datos personales) y se informa en el log.
    for (const version of document.versions) {
      try {
        await this.storage.remove(version.filePath);
      } catch (error) {
        this.logger.error(
          `No se pudo eliminar el archivo ${version.filePath} del documento ${documentId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return {
      id: documentId,
      storeId: document.storeId,
      retainUntil,
      deletedVersions: document.versions.length,
    };
  }

  // El hash SHA-256 es único en document_versions: un mismo archivo no puede
  // registrarse dos veces (ni en otro documento ni como nueva versión).
  private async ensureNotRegistered(sha256Hash: string): Promise<void> {
    const existing = await this.prisma.documentVersion.findUnique({
      where: { sha256Hash },
      select: { documentId: true, versionNumber: true },
    });
    if (existing) {
      throw new ConflictException(
        `Este archivo ya está registrado (documento ${existing.documentId}, versión ${existing.versionNumber})`,
      );
    }
  }
}
