import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  parseCalendarDate,
  type CalendarDate,
} from '../audit/utils/business-day.util.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import type { UploadDocumentDto } from './dto/upload-document.dto.js';
import {
  DOCUMENT_SUBJECT_ROLES,
  type DocumentResponse,
  type UploadedDocumentFile,
} from './types/documents.types.js';
import {
  computeDocumentDeadlines,
  formatDbDate,
} from './utils/document-dates.util.js';

const DOCUMENT_INCLUDE = {
  documentType: { select: { code: true } },
  currentVersion: {
    include: { uploadedBy: { select: { firstName: true, lastName: true } } },
  },
} satisfies Prisma.DocumentInclude;

type DocumentWithRelations = Prisma.DocumentGetPayload<{
  include: typeof DOCUMENT_INCLUDE;
}>;

function toDocumentResponse(document: DocumentWithRelations): DocumentResponse {
  const version = document.currentVersion;
  // La carga siempre deja un trabajador y una versión vigente; si faltan, el
  // documento no se creó por este flujo.
  if (!version || document.subjectUserId === null) {
    throw new Error(
      `El documento ${document.id} no tiene versión o trabajador`,
    );
  }
  return {
    id: document.id,
    workerId: document.subjectUserId,
    storeId: document.storeId,
    type: document.documentType.code,
    title: document.title,
    issuedAt: document.issuedAt ? formatDbDate(document.issuedAt) : null,
    retainUntil: formatDbDate(document.retainUntil),
    dtRegistrationDueAt: document.dtRegistrationDueAt
      ? formatDbDate(document.dtRegistrationDueAt)
      : null,
    createdAt: document.createdAt,
    latestVersion: {
      id: version.id,
      number: version.versionNumber,
      fileName: version.fileName,
      mime: version.mimeType,
      size: Number(version.sizeBytes),
      sha256: version.sha256Hash,
      changeNote: version.changeNote,
      createdAt: version.uploadedAt,
      uploadedBy: `${version.uploadedBy.firstName} ${version.uploadedBy.lastName}`,
    },
  };
}

// Nombre original para mostrar y descargar: sin carpetas ni caracteres de
// control, y dentro del largo de la columna file_name. El archivo físico usa
// otro nombre, aleatorio (StorageService).
function sanitizeFileName(originalName: string): string {
  const baseName = originalName.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = baseName.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return Array.from(clean).slice(0, 255).join('') || 'documento';
}

// Gestor documental (SPRINT-2-T05): carga de documentos laborales en la
// carpeta digital de un trabajador, con versiones inmutables.
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

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
