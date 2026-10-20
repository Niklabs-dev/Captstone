import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ROLE } from '../auth/constants/roles.constants.js';
import { hasAnyRole } from '../auth/policies/store-access.policy.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import { DOCUMENT_SUBJECT_ROLES } from '../documents/types/documents.types.js';
import {
  computeDocumentDeadlines,
  formatDbDate,
  toDbDate,
} from '../documents/utils/document-dates.util.js';
import { sanitizeFileName } from '../documents/utils/file-name.util.js';
import { maxUploadBytes } from '../documents/utils/upload-limits.util.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { detectMimeType } from '../storage/utils/file-signature.util.js';
import type { ListPayslipsQueryDto } from './dto/list-payslips-query.dto.js';
import type { UploadPayslipDto } from './dto/upload-payslip.dto.js';
import {
  PAYSLIP_DOCUMENT_TYPE,
  PAYSLIP_MIME_TYPE,
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
// el trabajador (SPRINT-2-T13). El archivo se guarda en el gestor documental
// como documento LIQUIDACION, con su versión y hash SHA-256.
@Injectable()
export class PayrollService {
  private readonly maxUploadBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
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
