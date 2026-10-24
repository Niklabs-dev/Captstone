import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  parseCalendarDate,
  type CalendarDate,
} from '../audit/utils/business-day.util.js';
import { ROLE } from '../auth/constants/roles.constants.js';
import { hasAnyRole } from '../auth/policies/store-access.policy.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import {
  DOCUMENT_SUBJECT_ROLES,
  type IntegrityStatus,
} from '../documents/types/documents.types.js';
import {
  businessDateOf,
  computeDocumentDeadlines,
  formatDbDate,
  toDbDate,
} from '../documents/utils/document-dates.util.js';
import { buildDownloadFileName } from '../documents/utils/download-name.util.js';
import { sanitizeFileName } from '../documents/utils/file-name.util.js';
import { maxUploadBytes } from '../documents/utils/upload-limits.util.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StoresService } from '../stores/stores.service.js';
import { StorageService } from '../storage/storage.service.js';
import { detectMimeType } from '../storage/utils/file-signature.util.js';
import type { ListPayslipsQueryDto } from './dto/list-payslips-query.dto.js';
import type { PublishPayslipDto } from './dto/publish-payslip.dto.js';
import type { UploadPayslipDto } from './dto/upload-payslip.dto.js';
import {
  PAYSLIP_DOCUMENT_TYPE,
  PAYSLIP_MIME_TYPE,
  type OwnPayslip,
  type OwnPayslipDownload,
  type OwnPayslipIntegrity,
  type OwnPayslipList,
  type PayslipCollection,
  type PayslipResponse,
  type PayslipWorker,
  type UploadedPayslipFile,
} from './types/payroll.types.js';
import {
  formatPayrollPeriod,
  isFuturePeriod,
  parsePayrollPeriod,
  payslipRevision,
} from './utils/payroll-period.util.js';

const WORKER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  isActive: true,
} satisfies Prisma.UserSelect;

const PAYSLIP_INCLUDE = {
  worker: { select: WORKER_SELECT },
  document: {
    select: {
      store: { select: { id: true, name: true } },
      currentVersion: {
        select: { fileName: true, sizeBytes: true, sha256Hash: true },
      },
    },
  },
} satisfies Prisma.PayslipInclude;

type PayslipWithRelations = Prisma.PayslipGetPayload<{
  include: typeof PAYSLIP_INCLUDE;
}>;

// Liquidación publicada con el archivo de su versión vigente: la que ve y
// descarga su trabajador (SPRINT-2-T15).
const OWN_PAYSLIP_INCLUDE = {
  document: {
    select: {
      title: true,
      storeId: true,
      currentVersion: {
        select: {
          id: true,
          versionNumber: true,
          fileName: true,
          filePath: true,
          mimeType: true,
          sizeBytes: true,
          sha256Hash: true,
        },
      },
    },
  },
} satisfies Prisma.PayslipInclude;

type OwnPayslipWithFile = Prisma.PayslipGetPayload<{
  include: typeof OWN_PAYSLIP_INCLUDE;
}>;

type PublishedVersion = NonNullable<
  OwnPayslipWithFile['document']['currentVersion']
>;

const PAYSLIP_NOT_FOUND_MESSAGE = 'Liquidación no encontrada';

// Trabajadores con carpeta digital (TRABAJADOR y SUPERVISOR) que pueden
// recibir una liquidación: activos, con local y sin anonimizar.
const PAYSLIP_WORKER_WHERE = {
  role: { code: { in: [...DOCUMENT_SUBJECT_ROLES] } },
  isActive: true,
  anonymizedAt: null,
  storeId: { not: null },
} satisfies Prisma.UserWhereInput;

function workerName(worker: { firstName: string; lastName: string }): string {
  return `${worker.firstName} ${worker.lastName}`;
}

// Versión vigente y fecha de firma de una liquidación publicada: la carga
// siempre deja la versión y la publicación fija la firma y su fecha.
function publishedFile(payslip: OwnPayslipWithFile): {
  version: PublishedVersion;
  signedAt: Date;
  publishedAt: Date;
} {
  const version = payslip.document.currentVersion;
  if (!version || !payslip.signedAt || !payslip.publishedAt) {
    throw new Error(`La liquidación ${payslip.id} no está publicada completa`);
  }
  return {
    version,
    signedAt: payslip.signedAt,
    publishedAt: payslip.publishedAt,
  };
}

function toOwnPayslip(payslip: OwnPayslipWithFile): OwnPayslip {
  const { version, signedAt, publishedAt } = publishedFile(payslip);
  return {
    id: payslip.id,
    versionId: version.id,
    workerId: payslip.workerId,
    period: formatPayrollPeriod(payslip.period),
    status: 'PUBLISHED',
    fileName: version.fileName,
    mime: version.mimeType,
    size: Number(version.sizeBytes),
    sha256: version.sha256Hash,
    signedAt: formatDbDate(signedAt),
    publishedAt,
  };
}

function toPayslipResponse(
  payslip: PayslipWithRelations,
  currentUser: AuthUser,
): PayslipResponse {
  const version = payslip.document.currentVersion;
  // La carga siempre deja la versión vigente del documento.
  if (!version) {
    throw new Error(`La liquidación ${payslip.id} no tiene versión vigente`);
  }
  return {
    id: payslip.id,
    worker: {
      id: payslip.worker.id,
      name: workerName(payslip.worker),
      store: payslip.document.store,
      isActive: payslip.worker.isActive,
    },
    period: formatPayrollPeriod(payslip.period),
    fileName: version.fileName,
    size: Number(version.sizeBytes),
    sha256: version.sha256Hash,
    createdAt: payslip.createdAt,
    status: payslip.status,
    signedAt: payslip.signedAt ? formatDbDate(payslip.signedAt) : null,
    publishedAt: payslip.publishedAt,
    revision: payslipRevision(payslip.updatedAt),
    canPublish:
      payslip.status === 'PENDING_SIGNATURE' &&
      hasAnyRole(currentUser, [ROLE.CONTADOR]),
  };
}

// Liquidaciones de sueldo (E2-H1): el contador carga la liquidación de un
// trabajador para un período, que queda pendiente de firma y no visible para
// el trabajador (SPRINT-2-T13), y luego confirma su publicación
// (SPRINT-2-T14); el trabajador ve y descarga solo sus liquidaciones
// publicadas (SPRINT-2-T15). El archivo se guarda en el gestor documental como
// documento LIQUIDACION, con su versión y hash SHA-256.
@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);
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

  // Liquidaciones cargadas, el selector de trabajadores para la carga y las
  // reglas de carga del usuario actual.
  async list(
    query: ListPayslipsQueryDto,
    currentUser: AuthUser,
  ): Promise<PayslipCollection> {
    const period =
      query.period === undefined ? undefined : parsePayrollPeriod(query.period);
    const [payslips, workers] = await Promise.all([
      this.prisma.payslip.findMany({
        where: {
          period: period ? toDbDate(period) : undefined,
          status: query.status,
          document: { storeId: query.storeId },
        },
        include: PAYSLIP_INCLUDE,
        orderBy: [
          { period: 'desc' },
          { worker: { firstName: 'asc' } },
          { worker: { lastName: 'asc' } },
          { id: 'asc' },
        ],
      }),
      this.prisma.user.findMany({
        where: { ...PAYSLIP_WORKER_WHERE, storeId: query.storeId },
        select: {
          ...WORKER_SELECT,
          store: { select: { id: true, name: true } },
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }],
      }),
    ]);

    return {
      items: payslips.map((payslip) => toPayslipResponse(payslip, currentUser)),
      workers: workers.flatMap((worker): PayslipWorker[] =>
        // PAYSLIP_WORKER_WHERE exige local.
        worker.store
          ? [
              {
                id: worker.id,
                name: workerName(worker),
                store: worker.store,
                isActive: worker.isActive,
              },
            ]
          : [],
      ),
      policy: {
        maxBytes: this.maxUploadBytes,
        allowedMimes: [PAYSLIP_MIME_TYPE],
        canUpload: hasAnyRole(currentUser, [ROLE.CONTADOR]),
      },
    };
  }

  // Carga la liquidación de un trabajador para un período en estado
  // PENDING_SIGNATURE. Valida período, trabajador activo y duplicados antes de
  // guardar el archivo, para no dejarlo huérfano en disco si se rechaza.
  async upload(
    dto: UploadPayslipDto,
    file: UploadedPayslipFile | undefined,
    currentUser: AuthUser,
  ): Promise<PayslipResponse> {
    if (!file) {
      throw new BadRequestException(
        'Falta el archivo de la liquidación (campo file)',
      );
    }

    const period = parsePayrollPeriod(dto.period);
    if (!period) {
      throw new BadRequestException('period debe tener el formato YYYY-MM');
    }
    if (isFuturePeriod(period, new Date())) {
      throw new BadRequestException(
        'El período no puede ser posterior al mes en curso',
      );
    }

    const worker = await this.prisma.user.findUnique({
      where: { id: dto.workerId },
      include: { role: { select: { code: true } } },
    });
    if (!worker) {
      throw new NotFoundException('Trabajador no encontrado');
    }
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
    if (!worker.isActive || worker.anonymizedAt !== null) {
      throw new BadRequestException('El trabajador no está activo');
    }
    await this.stores.assertActive(workerStoreId);

    const periodDate = toDbDate(period);
    const existing = await this.prisma.payslip.findUnique({
      where: { workerId_period: { workerId: worker.id, period: periodDate } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        `Ya existe una liquidación de este trabajador para el período ${dto.period}`,
      );
    }

    // Solo PDF: el tipo se valida por el contenido. Un archivo vacío lo
    // rechaza StorageService (400).
    if (
      file.buffer.length > 0 &&
      detectMimeType(file.buffer) !== PAYSLIP_MIME_TYPE
    ) {
      throw new UnsupportedMediaTypeException(
        'La liquidación debe ser un archivo PDF',
      );
    }
    await this.ensureNotRegistered(this.storage.computeSha256(file.buffer));

    const documentType = await this.prisma.documentType.findUnique({
      where: { code: PAYSLIP_DOCUMENT_TYPE },
    });
    if (!documentType || !documentType.isActive) {
      throw new Error(
        `El tipo de documento ${PAYSLIP_DOCUMENT_TYPE} no existe o está inactivo (seed)`,
      );
    }

    const stored = await this.storage.save(file.buffer, file.mimetype);

    try {
      const payslip = await this.prisma.$transaction(async (tx) => {
        const document = await tx.document.create({
          data: {
            title: `Liquidación de sueldo ${dto.period}`,
            ...computeDocumentDeadlines({
              issuedAt: null,
              uploadedAt: new Date(),
              retentionYears: documentType.retentionYears,
              requiresDtRegistration: documentType.requiresDtRegistration,
            }),
            storeId: workerStoreId,
            subjectUserId: worker.id,
            documentTypeId: documentType.id,
            createdById: currentUser.id,
          },
        });
        const version = await tx.documentVersion.create({
          data: {
            documentId: document.id,
            versionNumber: 1,
            fileName: sanitizeFileName(file.originalname),
            filePath: stored.relativePath,
            mimeType: stored.mimeType,
            sizeBytes: stored.sizeBytes,
            sha256Hash: stored.sha256Hash,
            uploadedById: currentUser.id,
          },
        });
        await tx.document.update({
          where: { id: document.id },
          data: { currentVersionId: version.id },
        });
        return tx.payslip.create({
          data: {
            period: periodDate,
            documentId: document.id,
            workerId: worker.id,
            createdById: currentUser.id,
          },
          include: PAYSLIP_INCLUDE,
        });
      });
      return toPayslipResponse(payslip, currentUser);
    } catch (error) {
      // Carga simultánea del mismo período o del mismo archivo: lo detectan
      // los índices únicos (worker_id, period) y sha256_hash. El archivo
      // físico queda sin registro (su nombre no contiene datos personales).
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Ya existe una liquidación de este trabajador para el período o el archivo ya está registrado',
        );
      }
      throw error;
    }
  }

  // Publica una liquidación pendiente de firma (SPRINT-2-T14): queda visible
  // en el portal de su trabajador con fecha de firma, fecha de publicación y
  // quién la publicó. Solo el paso PENDING_SIGNATURE → PUBLISHED: después la
  // base de datos rechaza editarla o eliminarla (triggers de la migración
  // liquidaciones_publicadas_inmutables).
  async publish(
    payslipId: string,
    dto: PublishPayslipDto,
    currentUser: AuthUser,
  ): Promise<PayslipResponse> {
    const now = new Date();
    const today = businessDateOf(now);
    let signedAt: CalendarDate = today;
    if (dto.signedAt !== undefined) {
      const parsed = parseCalendarDate(dto.signedAt);
      if (!parsed) {
        throw new BadRequestException('signedAt no es una fecha válida');
      }
      signedAt = parsed;
    }

    const current = await this.prisma.payslip.findUnique({
      where: { id: payslipId },
      include: {
        document: {
          select: {
            currentVersion: { select: { filePath: true, sha256Hash: true } },
          },
        },
      },
    });
    if (!current) {
      throw new NotFoundException(PAYSLIP_NOT_FOUND_MESSAGE);
    }
    const signedAtDb = toDbDate(signedAt);
    if (
      signedAtDb > toDbDate(today) ||
      signedAtDb < toDbDate(businessDateOf(current.createdAt))
    ) {
      throw new BadRequestException(
        'signedAt debe estar entre el día de carga y hoy',
      );
    }
    // No se publica un archivo distinto al que se cargó: se recalcula su hash
    // antes de abrir la transacción (lectura de disco).
    const version = current.document.currentVersion;
    if (!version || !(await this.isFileIntact(version))) {
      throw new ConflictException(
        'El archivo de la liquidación no coincide con el hash registrado: no se puede publicar',
      );
    }

    const published = await this.prisma.$transaction(async (tx) => {
      // Bloquea la fila hasta el fin de la transacción: dos publicaciones
      // simultáneas se serializan y la segunda ve el estado de la primera.
      await tx.$queryRaw`SELECT id FROM payslips WHERE id = ${payslipId}::uuid FOR UPDATE`;
      const payslip = await tx.payslip.findUniqueOrThrow({
        where: { id: payslipId },
      });
      if (payslip.status === 'PUBLISHED') {
        throw new ConflictException('La liquidación ya está publicada');
      }
      if (payslipRevision(payslip.updatedAt) !== dto.revision) {
        throw new ConflictException(
          'La liquidación cambió desde que se consultó; actualiza el listado',
        );
      }
      return tx.payslip.update({
        where: { id: payslipId },
        data: {
          status: 'PUBLISHED',
          signedAt: signedAtDb,
          publishedAt: now,
          publishedById: currentUser.id,
        },
        include: PAYSLIP_INCLUDE,
      });
    });
    return toPayslipResponse(published, currentUser);
  }

  // Liquidaciones publicadas del trabajador autenticado, de la más reciente a
  // la más antigua. El trabajador sale del token, nunca de un parámetro (Ley
  // N°21.719); las pendientes de firma no se devuelven (criterio 2 de E2-H1).
  async listOwn(currentUser: AuthUser): Promise<OwnPayslipList> {
    const payslips = await this.prisma.payslip.findMany({
      where: { workerId: currentUser.id, status: 'PUBLISHED' },
      include: OWN_PAYSLIP_INCLUDE,
      orderBy: [{ period: 'desc' }, { id: 'asc' }],
    });
    return { items: payslips.map(toOwnPayslip) };
  }

  // Recalcula el SHA-256 del archivo de una liquidación propia y lo compara
  // con el registrado al cargarla (criterio 3 de E2-H1). Un archivo faltante
  // es un resultado (MISSING), no un error.
  async checkOwnIntegrity(
    payslipId: string,
    currentUser: AuthUser,
  ): Promise<OwnPayslipIntegrity> {
    const payslip = await this.findOwnPublished(payslipId, currentUser);
    const { version } = publishedFile(payslip);
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
        `Verificación de la liquidación ${payslip.id}: integridad ${status}`,
      );
    }
    return {
      payslipId: payslip.id,
      versionId: version.id,
      workerId: payslip.workerId,
      status,
      valid: status === 'VALID',
      expectedHash: version.sha256Hash,
      actualHash,
      checkedAt: new Date(),
    };
  }

  // Archivo de una liquidación propia. Recalcula el hash: si no coincide la
  // descarga continúa, pero informa ALTERED para advertirlo (igual que el
  // gestor documental). Si el archivo no está, StorageService responde 404.
  async downloadOwn(
    payslipId: string,
    currentUser: AuthUser,
  ): Promise<OwnPayslipDownload> {
    const payslip = await this.findOwnPublished(payslipId, currentUser);
    const { version } = publishedFile(payslip);
    const content = await this.storage.read(version.filePath);
    const integrity =
      this.storage.computeSha256(content) === version.sha256Hash
        ? 'VALID'
        : 'ALTERED';
    if (integrity === 'ALTERED') {
      this.logger.warn(
        `Descarga de la liquidación ${payslip.id} con integridad ALTERED`,
      );
    }
    return {
      content,
      fileName: buildDownloadFileName(
        PAYSLIP_DOCUMENT_TYPE,
        payslip.document.title,
        version.versionNumber,
        version.mimeType,
      ),
      mimeType: version.mimeType,
      integrity,
      versionId: version.id,
      storeId: payslip.document.storeId,
    };
  }

  // Liquidación publicada del trabajador autenticado. Una ajena, una
  // pendiente de firma o una inexistente responden igual (404), para no
  // revelar que existe.
  private async findOwnPublished(
    payslipId: string,
    currentUser: AuthUser,
  ): Promise<OwnPayslipWithFile> {
    const payslip = await this.prisma.payslip.findFirst({
      where: { id: payslipId, workerId: currentUser.id, status: 'PUBLISHED' },
      include: OWN_PAYSLIP_INCLUDE,
    });
    if (!payslip) {
      throw new NotFoundException(PAYSLIP_NOT_FOUND_MESSAGE);
    }
    return payslip;
  }

  // Recalcula el SHA-256 del archivo guardado; false si fue alterado o no
  // está en el almacenamiento.
  private async isFileIntact(version: {
    filePath: string;
    sha256Hash: string;
  }): Promise<boolean> {
    try {
      return await this.storage.verifyIntegrity(
        version.filePath,
        version.sha256Hash,
      );
    } catch (error) {
      if (error instanceof NotFoundException) return false;
      throw error;
    }
  }

  // El hash SHA-256 es único en document_versions: el mismo archivo no puede
  // registrarse dos veces, ni como liquidación ni como documento laboral.
  private async ensureNotRegistered(sha256Hash: string): Promise<void> {
    const existing = await this.prisma.documentVersion.findUnique({
      where: { sha256Hash },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Este archivo ya está registrado');
    }
  }
}
