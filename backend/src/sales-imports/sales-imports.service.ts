import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/types/auth.types.js';
import { sanitizeFileName } from '../documents/utils/file-name.util.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AUDIT_ACTION } from '../audit/constants/audit-actions.constants.js';
import type {
  ConfirmSalesImportDto,
  ListSalesImportsQueryDto,
  SalesImportResolutionDto,
} from './dto/sales-import-request.dto.js';
import { MrComandaReportError } from './parser/mrcomanda-report.errors.js';
import type {
  ParsedMrComandaReport,
  ParsedPaymentLine,
} from './parser/mrcomanda-report.types.js';
import { readMrComandaReport } from './parser/read-mrcomanda-report.js';
import {
  type ManualResolutionPlan,
  planManualResolution,
} from './resolution/manual-resolution.plan.js';
import {
  type ResolvedPaymentMethod,
  type ResolvedSalesReport,
  SalesImportResolverService,
} from './sales-import-resolver.service.js';
import {
  SalesImportStorageService,
  XLSX_MIME_TYPE,
} from './sales-import-storage.service.js';
import type {
  SalesImportAuditOrigin,
  SalesImportConfirmResult,
  SalesImportDetail,
  SalesImportFileDownload,
  SalesImportManualResolutionSummary,
  SalesImportPreview,
  SalesImportPreviewOutcome,
  SalesImportPreviewResult,
  SalesImportResolutionOptions,
  SalesImportResolvedConfirmResult,
  SalesImportSummary,
  SalesImportUploadedFile,
  SalesImportVersionRef,
} from './types/sales-imports.types.js';
import {
  databaseRuleViolation,
  isUniqueViolation,
  reportErrorToHttp,
} from './utils/sales-import-errors.util.js';

// Importación diaria de ventas MrComanda (SPRINT-4R-T10).
//
// Flujo: el administrador sube el Excel (vista previa) → se lee y valida con
// el parser de SPRINT-4R-T09 → se resuelve local y medios con las
// equivalencias de SPRINT-4R-T08 → si todo resuelve, se guarda el archivo en
// el volumen privado y la importación queda PENDING con su siguiente versión.
// Al confirmar, en UNA transacción la vigente pasa a SUPERSEDED y la nueva a
// ACTIVE. Garantías:
// - Idempotencia: el mismo archivo (hash) para el mismo local y fecha devuelve
//   la importación existente sin duplicarla (también en cargas simultáneas:
//   bloqueo del local y restricción única de T08).
// - Corrección explícita: confirmar exige expectedActiveImportId, la versión
//   vigente que se reemplaza; si cambió desde la vista previa, 409.
// - Sin restos: si la transacción falla, el archivo guardado se elimina; la
//   cabecera y sus líneas se crean juntas o no se crean.
// - Solo totales diarios: no hay formulario manual de ventas ni se calculan
//   propinas o descuadres desde el archivo.
// - Omisión automática (SPRINT-4A-T21): una línea en 0 sin alias no bloquea
//   la carga; se guarda como línea omitida AUTOMATIC junto con la cabecera.

const PERSON_SELECT = {
  select: { id: true, firstName: true, lastName: true },
} as const;

const SUMMARY_SELECT = {
  id: true,
  status: true,
  version: true,
  businessDate: true,
  periodStart: true,
  periodEnd: true,
  issuedAt: true,
  externalStoreCode: true,
  subwayStoreId: true,
  totalAmount: true,
  fileName: true,
  sizeBytes: true,
  sha256Hash: true,
  createdAt: true,
  confirmedAt: true,
  supersededAt: true,
  storeResolution: true,
  resolvedAt: true,
  store: { select: { id: true, name: true } },
  uploadedBy: PERSON_SELECT,
  confirmedBy: PERSON_SELECT,
  resolvedBy: PERSON_SELECT,
} satisfies Prisma.SalesImportSelect;

const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  storeId: true,
  lines: {
    orderBy: { lineNumber: 'asc' },
    select: {
      lineNumber: true,
      originalLabel: true,
      amount: true,
      percentage: true,
      resolution: true,
      paymentMethod: { select: { id: true, code: true, name: true } },
    },
  },
  skippedLines: {
    orderBy: { lineNumber: 'asc' },
    select: {
      lineNumber: true,
      originalLabel: true,
      amount: true,
      percentage: true,
      resolution: true,
    },
  },
} satisfies Prisma.SalesImportSelect;

const VERSION_SELECT = {
  id: true,
  version: true,
  status: true,
  createdAt: true,
  confirmedAt: true,
  supersededAt: true,
} satisfies Prisma.SalesImportSelect;

type SummaryRecord = Prisma.SalesImportGetPayload<{
  select: typeof SUMMARY_SELECT;
}>;
type DetailRecord = Prisma.SalesImportGetPayload<{
  select: typeof DETAIL_SELECT;
}>;
type VersionRecord = Prisma.SalesImportGetPayload<{
  select: typeof VERSION_SELECT;
}>;

type DbClient = PrismaService | Prisma.TransactionClient;

const DEFAULT_LIST_LIMIT = 100;

function personName(person: { firstName: string; lastName: string }): string {
  return `${person.firstName} ${person.lastName}`.trim();
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Fecha de negocio YYYY-MM-DD como valor de la columna DATE.
function dbDate(isoDateText: string): Date {
  return new Date(`${isoDateText}T00:00:00.000Z`);
}

function toSummary(record: SummaryRecord): SalesImportSummary {
  return {
    id: record.id,
    status: record.status,
    version: record.version,
    store: record.store,
    businessDate: isoDate(record.businessDate),
    periodStart: record.periodStart,
    periodEnd: record.periodEnd,
    issuedAt: record.issuedAt,
    externalStoreCode: record.externalStoreCode,
    subwayStoreId: record.subwayStoreId,
    totalAmount: Number(record.totalAmount),
    fileName: record.fileName,
    sizeBytes: Number(record.sizeBytes),
    sha256Hash: record.sha256Hash,
    uploadedBy: {
      id: record.uploadedBy.id,
      name: personName(record.uploadedBy),
    },
    createdAt: record.createdAt,
    confirmedBy: record.confirmedBy
      ? { id: record.confirmedBy.id, name: personName(record.confirmedBy) }
      : null,
    confirmedAt: record.confirmedAt,
    supersededAt: record.supersededAt,
    storeResolution: record.storeResolution,
    resolvedBy: record.resolvedBy
      ? { id: record.resolvedBy.id, name: personName(record.resolvedBy) }
      : null,
    resolvedAt: record.resolvedAt,
  };
}

function decimalOrNull(value: number | null): Prisma.Decimal | null {
  return value === null ? null : new Prisma.Decimal(value.toFixed(2));
}

function toVersionRef(record: VersionRecord): SalesImportVersionRef {
  return {
    id: record.id,
    version: record.version,
    status: record.status,
    createdAt: record.createdAt,
    confirmedAt: record.confirmedAt,
    supersededAt: record.supersededAt,
  };
}

// Medio resuelto de cada línea; la resolución ya garantizó que existe
// (canConfirm), así que un faltante aquí es un error de programación.
function requireMethod(
  method: ResolvedPaymentMethod | null,
  label: string,
): ResolvedPaymentMethod {
  if (method === null) {
    throw new Error(`La línea «${label}» no tiene medio de pago resuelto`);
  }
  return method;
}

// Línea del plan sin medio asignado: applyChoices cubre todas, así que un
// faltante es un error de programación.
function requireLineMethod(
  methodIds: ReadonlyMap<number, string>,
  lineNumber: number,
): string {
  const id = methodIds.get(lineNumber);
  if (id === undefined) {
    throw new Error(`La línea ${lineNumber} no tiene medio de pago asignado`);
  }
  return id;
}

// Medio creado desde la vista previa (SPRINT-4A-T21): fuera de la
// conciliación de vouchers y al final del orden; se ajusta después en la
// administración de medios de pago.
const NEW_METHOD_BEHAVIOR = 'EXTERNAL_OTHER' as const;
const NEW_METHOD_SORT_STEP = 10;
// sort_order es INTEGER: el orden nunca supera su máximo.
const MAX_SORT_ORDER = 2_147_483_647;

@Injectable()
export class SalesImportsService {
  private readonly logger = new Logger(SalesImportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: SalesImportResolverService,
    private readonly storage: SalesImportStorageService,
  ) {}

  // Lee, valida y resuelve el Excel; si todo resuelve lo guarda como PENDING.
  async preview(
    file: SalesImportUploadedFile | undefined,
    currentUser: AuthUser,
  ): Promise<SalesImportPreviewResult> {
    if (!file) {
      throw new BadRequestException(
        'Adjunta el «Informe de Ventas Diario» de MrComanda en el campo file',
      );
    }
    const report = await this.readReport(file.buffer);
    const resolution = await this.resolver.resolve(report);
    const businessDate = dbDate(report.businessDate);

    if (!resolution.canConfirm || resolution.store === null) {
      const active = resolution.store
        ? await this.findActiveVersion(resolution.store.id, businessDate)
        : null;
      return {
        created: false,
        preview: this.buildPreview(
          'UNRESOLVED',
          resolution,
          null,
          active,
          await this.resolutionOptions(resolution, businessDate),
        ),
      };
    }

    const storeId = resolution.store.id;
    const sha256Hash = this.storage.computeSha256(file.buffer);
    const existing = await this.findIdByHash(storeId, businessDate, sha256Hash);
    if (existing !== null) {
      return {
        created: false,
        preview: await this.previewOf('EXISTING', resolution, existing),
      };
    }

    const stored = await this.storage.save(file.buffer);
    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        // Serializa las cargas del local: dos cargas simultáneas esperan aquí
        // y la segunda ve la versión que asignó la primera.
        await tx.$queryRaw`SELECT id FROM stores WHERE id = ${storeId}::uuid FOR UPDATE`;
        const concurrent = await this.findIdByHash(
          storeId,
          businessDate,
          sha256Hash,
          tx,
        );
        if (concurrent !== null) return { id: concurrent, created: false };

        const last = await tx.salesImport.aggregate({
          where: { storeId, businessDate },
          _max: { version: true },
        });
        const header = await tx.salesImport.create({
          data: {
            system: 'MRCOMANDA',
            storeId,
            businessDate,
            periodStart: report.periodStart,
            periodEnd: report.periodEnd,
            issuedAt: report.issuedAt,
            externalStoreCode: report.externalStoreCode,
            // El trigger vuelve a exigir que sea el ID Subway del local.
            subwayStoreId: report.subwayStoreId,
            version: (last._max.version ?? 0) + 1,
            totalAmount: BigInt(report.totalAmount),
            fileName: sanitizeFileName(file.originalname),
            filePath: stored.relativePath,
            mimeType: XLSX_MIME_TYPE,
            sizeBytes: BigInt(stored.sizeBytes),
            sha256Hash: stored.sha256Hash,
            uploadedById: currentUser.id,
          },
          select: { id: true },
        });
        // Cabecera y líneas en la misma transacción: si falla una línea no
        // queda una importación a medias.
        await tx.salesImportLine.createMany({
          data: resolution.lines
            .filter((line) => !line.skipped)
            .map((line) => ({
              importId: header.id,
              lineNumber: line.lineNumber,
              originalLabel: line.originalLabel,
              normalizedLabel: line.normalizedLabel,
              amount: BigInt(line.amount),
              percentage: decimalOrNull(line.percentage),
              paymentMethodId: requireMethod(
                line.paymentMethod,
                line.originalLabel,
              ).id,
            })),
        });
        // Líneas en 0 sin alias: se omiten solas (SPRINT-4A-T21). El trigger
        // vuelve a exigir monto 0 y etiqueta sin alias.
        await this.createSkippedLines(
          tx,
          header.id,
          resolution.lines.filter((line) => line.skipped),
        );
        return { id: header.id, created: true };
      });
      if (!outcome.created) {
        await this.removeOrphanFile(stored.relativePath);
      }
      return {
        created: outcome.created,
        preview: await this.previewOf(
          outcome.created ? 'CREATED' : 'EXISTING',
          resolution,
          outcome.id,
        ),
      };
    } catch (error) {
      await this.removeOrphanFile(stored.relativePath);
      // Carrera residual con el mismo archivo: la restricción única de T08 la
      // resuelve y se responde con la importación que ganó.
      if (isUniqueViolation(error)) {
        const concurrent = await this.findIdByHash(
          storeId,
          businessDate,
          sha256Hash,
        );
        if (concurrent !== null) {
          return {
            created: false,
            preview: await this.previewOf('EXISTING', resolution, concurrent),
          };
        }
      }
      // Una equivalencia que cambió entre la resolución y el guardado (los
      // triggers de T08 la vuelven a exigir): se pide repetir la carga.
      const rule = databaseRuleViolation(error);
      if (rule !== null) {
        throw new ConflictException(
          `${rule}. Las equivalencias cambiaron durante la carga: vuelve a subir el archivo.`,
        );
      }
      throw error;
    }
  }

  // Confirma una importación PENDING reemplazando a la vigente en una sola
  // transacción. Repetir la confirmación de una ya vigente es idempotente.
  async confirm(
    id: string,
    dto: ConfirmSalesImportDto,
    currentUser: AuthUser,
  ): Promise<SalesImportConfirmResult> {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const target = await tx.salesImport.findUnique({
          where: { id },
          select: { storeId: true, businessDate: true },
        });
        if (!target) {
          throw new NotFoundException('Importación de ventas no encontrada');
        }
        // Mismo orden de bloqueo que la vista previa (local y luego fila):
        // las confirmaciones del local se serializan y no hay interbloqueos.
        await tx.$queryRaw`SELECT id FROM stores WHERE id = ${target.storeId}::uuid FOR UPDATE`;
        const [locked] = await tx.$queryRaw<{ status: string }[]>`
          SELECT status::text AS status FROM sales_imports
          WHERE id = ${id}::uuid FOR UPDATE`;
        if (!locked) {
          throw new NotFoundException('Importación de ventas no encontrada');
        }
        const active = await tx.salesImport.findFirst({
          where: {
            storeId: target.storeId,
            businessDate: target.businessDate,
            status: 'ACTIVE',
          },
          select: VERSION_SELECT,
        });

        if (locked.status === 'ACTIVE') {
          return { confirmed: false, superseded: null };
        }
        if (locked.status !== 'PENDING') {
          throw new ConflictException({
            statusCode: 409,
            error: 'Conflict',
            message:
              'Esta versión ya fue reemplazada por otra y no se puede volver a confirmar; sube el archivo como una corrección nueva',
            activeImport: active ? toVersionRef(active) : null,
          });
        }
        if ((active?.id ?? null) !== dto.expectedActiveImportId) {
          throw new ConflictException({
            statusCode: 409,
            error: 'Conflict',
            message:
              'La versión vigente cambió desde la vista previa: revisa la importación vigente antes de confirmar',
            activeImport: active ? toVersionRef(active) : null,
          });
        }

        return {
          confirmed: true,
          superseded: await this.promote(tx, id, active, currentUser),
        };
      });
      return { ...result, import: await this.findOne(id) };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'Otra versión quedó vigente al mismo tiempo: revisa la importación vigente antes de confirmar',
        );
      }
      const rule = databaseRuleViolation(error);
      if (rule !== null) {
        throw new UnprocessableEntityException(rule);
      }
      throw error;
    }
  }

  // Importa y confirma en un solo paso un Excel cuya vista previa quedó
  // UNRESOLVED, con la resolución manual del administrador (SPRINT-4A-T18).
  // Se vuelve a leer y resolver el archivo, se valida la resolución completa
  // (400 sin guardar nada si falta algo) y, en UNA transacción, se aplica
  // «recordar» (ID Subway del local o alias del medio, auditados), se crea la
  // importación con lo resuelto a mano y quién lo resolvió, y queda vigente
  // reemplazando a la versión anterior igual que en confirm().
  async confirmWithResolution(
    file: SalesImportUploadedFile | undefined,
    dto: SalesImportResolutionDto,
    currentUser: AuthUser,
    origin: SalesImportAuditOrigin,
  ): Promise<SalesImportResolvedConfirmResult> {
    if (!file) {
      throw new BadRequestException(
        'Adjunta el «Informe de Ventas Diario» de MrComanda en el campo file',
      );
    }
    const report = await this.readReport(file.buffer);
    const resolution = await this.resolver.resolve(report);
    const plan = await this.planResolution(resolution, dto);
    const storeId = plan.store.id;
    const businessDate = dbDate(report.businessDate);
    const sha256Hash = this.storage.computeSha256(file.buffer);

    const stored = await this.storage.save(file.buffer);
    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        // Mismo orden de bloqueo que la vista previa y la confirmación.
        await tx.$queryRaw`SELECT id FROM stores WHERE id = ${storeId}::uuid FOR UPDATE`;
        const existing = await tx.salesImport.findUnique({
          where: {
            storeId_businessDate_sha256Hash: {
              storeId,
              businessDate,
              sha256Hash,
            },
          },
          select: { id: true, status: true, version: true },
        });
        if (existing !== null) {
          // Reintento del mismo archivo ya vigente en ese local: idempotente.
          if (existing.status === 'ACTIVE') {
            return {
              id: existing.id,
              confirmed: false,
              superseded: null,
              methodIds: new Map<number, string>(),
            };
          }
          throw new ConflictException(
            existing.status === 'PENDING'
              ? 'Este archivo ya tiene una vista previa pendiente para ese local: confírmala o descártala desde el historial'
              : `Este archivo ya se importó para ese local como la versión ${existing.version}, que fue reemplazada: sube el archivo corregido`,
          );
        }
        const active = await tx.salesImport.findFirst({
          where: { storeId, businessDate, status: 'ACTIVE' },
          select: VERSION_SELECT,
        });
        if ((active?.id ?? null) !== dto.expectedActiveImportId) {
          throw new ConflictException({
            statusCode: 409,
            error: 'Conflict',
            message:
              'La versión vigente cambió desde la vista previa: revisa la importación vigente antes de confirmar',
            activeImport: active ? toVersionRef(active) : null,
          });
        }

        const methodIds = await this.applyChoices(
          tx,
          plan,
          currentUser,
          origin,
        );

        const now = new Date();
        const last = await tx.salesImport.aggregate({
          where: { storeId, businessDate },
          _max: { version: true },
        });
        const header = await tx.salesImport.create({
          data: {
            system: 'MRCOMANDA',
            storeId,
            businessDate,
            periodStart: report.periodStart,
            periodEnd: report.periodEnd,
            issuedAt: report.issuedAt,
            externalStoreCode: report.externalStoreCode,
            // El ID Subway leído del archivo se guarda tal cual, aunque el
            // local se haya elegido a mano (el trigger revisa que no
            // identifique a otro local activo).
            subwayStoreId: report.subwayStoreId,
            version: (last._max.version ?? 0) + 1,
            totalAmount: BigInt(report.totalAmount),
            fileName: sanitizeFileName(file.originalname),
            filePath: stored.relativePath,
            mimeType: XLSX_MIME_TYPE,
            sizeBytes: BigInt(stored.sizeBytes),
            sha256Hash: stored.sha256Hash,
            uploadedById: currentUser.id,
            storeResolution: plan.storeResolution,
            resolvedById: currentUser.id,
            resolvedAt: now,
          },
          select: { id: true },
        });
        await tx.salesImportLine.createMany({
          data: plan.lines.map(({ line, resolution }) => ({
            importId: header.id,
            lineNumber: line.lineNumber,
            originalLabel: line.originalLabel,
            normalizedLabel: line.normalizedLabel,
            amount: BigInt(line.amount),
            percentage: decimalOrNull(line.percentage),
            paymentMethodId: requireLineMethod(methodIds, line.lineNumber),
            resolution,
          })),
        });
        await this.createSkippedLines(tx, header.id, plan.skipped);
        const superseded = await this.promote(
          tx,
          header.id,
          active,
          currentUser,
        );
        return { id: header.id, confirmed: true, superseded, methodIds };
      });
      if (!outcome.confirmed) {
        await this.removeOrphanFile(stored.relativePath);
      }
      return {
        import: await this.findOne(outcome.id),
        confirmed: outcome.confirmed,
        superseded: outcome.superseded,
        manualResolution: this.manualSummary(
          plan,
          report.subwayStoreId,
          outcome.methodIds,
        ),
      };
    } catch (error) {
      await this.removeOrphanFile(stored.relativePath);
      // Otra carga o un cambio de equivalencias ganó la carrera (mismo
      // archivo, ID Subway, alias o código de un medio nuevo creado al mismo
      // tiempo).
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'Otro cambio se guardó al mismo tiempo para este archivo, local o medio: vuelve a cargar el archivo',
        );
      }
      const rule = databaseRuleViolation(error);
      if (rule !== null) {
        throw new ConflictException(
          `${rule}. Las equivalencias cambiaron durante la carga: vuelve a subir el archivo.`,
        );
      }
      throw error;
    }
  }

  // Descarta una importación PENDING (vista previa no confirmada) y su
  // archivo. Las confirmadas o reemplazadas no se eliminan nunca.
  async discard(id: string): Promise<SalesImportSummary> {
    const discarded = await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ status: string }[]>`
        SELECT status::text AS status FROM sales_imports
        WHERE id = ${id}::uuid FOR UPDATE`;
      if (!locked) {
        throw new NotFoundException('Importación de ventas no encontrada');
      }
      if (locked.status !== 'PENDING') {
        throw new ConflictException(
          'Solo se pueden descartar importaciones pendientes de confirmar',
        );
      }
      const record = await tx.salesImport.findUniqueOrThrow({
        where: { id },
        select: { ...SUMMARY_SELECT, filePath: true },
      });
      await tx.salesImport.delete({ where: { id } });
      return record;
    });
    await this.removeOrphanFile(discarded.filePath);
    return toSummary(discarded);
  }

  async findAll(
    query: ListSalesImportsQueryDto,
  ): Promise<SalesImportSummary[]> {
    const records = await this.prisma.salesImport.findMany({
      where: {
        storeId: query.storeId,
        status: query.status,
        businessDate: {
          gte: query.from ? dbDate(query.from) : undefined,
          lte: query.to ? dbDate(query.to) : undefined,
        },
      },
      orderBy: [{ businessDate: 'desc' }, { version: 'desc' }],
      take: query.limit ?? DEFAULT_LIST_LIMIT,
      select: SUMMARY_SELECT,
    });
    return records.map(toSummary);
  }

  async findOne(
    id: string,
    db: DbClient = this.prisma,
  ): Promise<SalesImportDetail> {
    const record = await db.salesImport.findUnique({
      where: { id },
      select: DETAIL_SELECT,
    });
    if (!record) {
      throw new NotFoundException('Importación de ventas no encontrada');
    }
    return this.toDetail(record, db);
  }

  async downloadFile(id: string): Promise<SalesImportFileDownload> {
    const record = await this.prisma.salesImport.findUnique({
      where: { id },
      select: {
        id: true,
        storeId: true,
        fileName: true,
        filePath: true,
        sha256Hash: true,
      },
    });
    if (!record) {
      throw new NotFoundException('Importación de ventas no encontrada');
    }
    const content = await this.storage.read(record.filePath);
    return {
      importId: record.id,
      storeId: record.storeId,
      fileName: record.fileName,
      mimeType: XLSX_MIME_TYPE,
      content,
      integrity:
        this.storage.computeSha256(content) === record.sha256Hash
          ? 'VALID'
          : 'ALTERED',
    };
  }

  private async readReport(buffer: Buffer): Promise<ParsedMrComandaReport> {
    try {
      return await readMrComandaReport(buffer);
    } catch (error) {
      if (error instanceof MrComandaReportError) {
        throw reportErrorToHttp(error);
      }
      throw error;
    }
  }

  private async toDetail(
    record: DetailRecord,
    db: DbClient,
  ): Promise<SalesImportDetail> {
    const versions = await db.salesImport.findMany({
      where: { storeId: record.storeId, businessDate: record.businessDate },
      orderBy: { version: 'desc' },
      select: VERSION_SELECT,
    });
    return {
      ...toSummary(record),
      lines: record.lines.map((line) => ({
        lineNumber: line.lineNumber,
        originalLabel: line.originalLabel,
        amount: Number(line.amount),
        percentage: line.percentage === null ? null : Number(line.percentage),
        paymentMethod: line.paymentMethod,
        resolution: line.resolution,
      })),
      skippedLines: record.skippedLines.map((line) => ({
        lineNumber: line.lineNumber,
        originalLabel: line.originalLabel,
        amount: Number(line.amount),
        percentage: line.percentage === null ? null : Number(line.percentage),
        resolution: line.resolution,
      })),
      versions: versions.map(toVersionRef),
    };
  }

  private async findIdByHash(
    storeId: string,
    businessDate: Date,
    sha256Hash: string,
    db: DbClient = this.prisma,
  ): Promise<string | null> {
    const found = await db.salesImport.findUnique({
      where: {
        storeId_businessDate_sha256Hash: { storeId, businessDate, sha256Hash },
      },
      select: { id: true },
    });
    return found?.id ?? null;
  }

  private async findActiveVersion(
    storeId: string,
    businessDate: Date,
  ): Promise<SalesImportVersionRef | null> {
    const active = await this.prisma.salesImport.findFirst({
      where: { storeId, businessDate, status: 'ACTIVE' },
      select: VERSION_SELECT,
    });
    return active ? toVersionRef(active) : null;
  }

  private async previewOf(
    outcome: SalesImportPreviewOutcome,
    resolution: ResolvedSalesReport,
    importId: string,
  ): Promise<SalesImportPreview> {
    const detail = await this.findOne(importId);
    const active =
      detail.versions.find(
        (version) => version.status === 'ACTIVE' && version.id !== importId,
      ) ?? null;
    return this.buildPreview(outcome, resolution, detail, active);
  }

  private buildPreview(
    outcome: SalesImportPreviewOutcome,
    resolution: ResolvedSalesReport,
    detail: SalesImportDetail | null,
    activeImport: SalesImportVersionRef | null,
    resolutionOptions: SalesImportResolutionOptions | null = null,
  ): SalesImportPreview {
    const { report } = resolution;
    return {
      outcome,
      canConfirm: detail?.status === 'PENDING',
      issues: resolution.issues,
      businessDate: report.businessDate,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      issuedAt: report.issuedAt,
      externalStoreCode: report.externalStoreCode,
      subwayStoreId: report.subwayStoreId,
      store: resolution.store,
      totalAmount: report.totalAmount,
      lines: resolution.lines.map((line) => ({
        lineNumber: line.lineNumber,
        originalLabel: line.originalLabel,
        amount: line.amount,
        percentage: line.percentage,
        paymentMethod: line.paymentMethod,
        skipped: line.skipped,
      })),
      import: detail,
      activeImport,
      resolutionOptions,
    };
  }

  // Opciones de la resolución manual (SPRINT-4A-T18): locales activos con su
  // versión vigente en la fecha (solo si el local no se identificó) y medios
  // activos del catálogo (solo si alguna línea sin alias no se omite sola).
  private async resolutionOptions(
    resolution: ResolvedSalesReport,
    businessDate: Date,
  ): Promise<SalesImportResolutionOptions> {
    const needsStore = resolution.store === null;
    const needsMethods = resolution.lines.some(
      (line) => line.paymentMethod === null && !line.skipped,
    );
    const [stores, actives, paymentMethods] = await Promise.all([
      needsStore
        ? this.prisma.store.findMany({
            where: { isActive: true },
            orderBy: { name: 'asc' },
            select: { id: true, name: true, subwayStoreId: true },
          })
        : Promise.resolve([]),
      needsStore
        ? this.prisma.salesImport.findMany({
            where: { businessDate, status: 'ACTIVE' },
            select: { ...VERSION_SELECT, storeId: true },
          })
        : Promise.resolve([]),
      needsMethods
        ? this.prisma.paymentMethod.findMany({
            where: { isActive: true },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
            select: { id: true, code: true, name: true },
          })
        : Promise.resolve([]),
    ]);
    const activeByStore = new Map(
      actives.map((active) => [active.storeId, toVersionRef(active)]),
    );
    return {
      stores: stores.map((store) => ({
        id: store.id,
        name: store.name,
        subwayStoreId: store.subwayStoreId,
        activeImport: activeByStore.get(store.id) ?? null,
      })),
      paymentMethods,
    };
  }

  // Pasa la importación PENDING a vigente y, si había, la anterior a
  // reemplazada, en la transacción del llamador (el trigger revisa que las
  // líneas sumen el total).
  private async promote(
    tx: Prisma.TransactionClient,
    id: string,
    active: VersionRecord | null,
    currentUser: AuthUser,
  ): Promise<SalesImportVersionRef | null> {
    const now = new Date();
    if (active) {
      await tx.salesImport.update({
        where: { id: active.id },
        data: { status: 'SUPERSEDED', isCurrent: null, supersededAt: now },
      });
    }
    await tx.salesImport.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        isCurrent: true,
        confirmedAt: now,
        confirmedById: currentUser.id,
      },
    });
    return active
      ? { ...toVersionRef(active), status: 'SUPERSEDED', supersededAt: now }
      : null;
  }

  // Lee de la base lo que eligió el administrador y arma el plan (400 si la
  // resolución no es válida o está incompleta).
  // El catálogo completo (activos e inactivos) es pequeño: se lee entero
  // para validar los medios elegidos y que uno nuevo no repita a otro.
  private async planResolution(
    resolution: ResolvedSalesReport,
    dto: SalesImportResolutionDto,
  ): Promise<ManualResolutionPlan> {
    const [store, catalog] = await Promise.all([
      dto.store
        ? this.prisma.store.findUnique({
            where: { id: dto.store.storeId },
            select: {
              id: true,
              name: true,
              isActive: true,
              subwayStoreId: true,
            },
          })
        : Promise.resolve(null),
      dto.lines.length > 0
        ? this.prisma.paymentMethod.findMany({
            select: { id: true, code: true, name: true, isActive: true },
          })
        : Promise.resolve([]),
    ]);
    return planManualResolution(resolution, dto, store, catalog);
  }

  private manualSummary(
    plan: ManualResolutionPlan,
    subwayStoreId: string | null,
    methodIds: ReadonlyMap<number, string>,
  ): SalesImportManualResolutionSummary {
    return {
      store:
        plan.storeResolution === 'MANUAL'
          ? {
              storeId: plan.store.id,
              subwayStoreId,
              remembered: plan.rememberSubwayStoreId !== null,
            }
          : null,
      lines: plan.lines
        .filter((line) => line.resolution === 'MANUAL')
        .map((line) => ({
          lineNumber: line.line.lineNumber,
          originalLabel: line.line.originalLabel,
          action:
            line.target.kind === 'NEW'
              ? ('CREATE' as const)
              : ('ASSIGN' as const),
          // null solo si un reintento idempotente no creó el medio nuevo
          // (ese reintento no se audita).
          paymentMethodId:
            methodIds.get(line.line.lineNumber) ??
            (line.target.kind === 'EXISTING'
              ? line.target.paymentMethodId
              : null),
          remembered: line.remember,
        })),
      skippedLines: plan.skipped.map((line) => ({
        lineNumber: line.lineNumber,
        originalLabel: line.originalLabel,
      })),
    };
  }

  // Líneas omitidas solas (SPRINT-4A-T21): monto 0 y etiqueta sin alias.
  private async createSkippedLines(
    tx: Prisma.TransactionClient,
    importId: string,
    lines: readonly ParsedPaymentLine[],
  ): Promise<void> {
    if (lines.length === 0) return;
    await tx.salesImportSkippedLine.createMany({
      data: lines.map((line) => ({
        importId,
        lineNumber: line.lineNumber,
        originalLabel: line.originalLabel,
        normalizedLabel: line.normalizedLabel,
        amount: BigInt(line.amount),
        percentage: decimalOrNull(line.percentage),
        resolution: 'AUTOMATIC' as const,
      })),
    });
  }

  // Aplica lo elegido a mano en la transacción de la confirmación y devuelve
  // el medio de cada línea (número de línea → ID):
  // - Medios nuevos (SPRINT-4A-T21): se dan de alta activos, EXTERNAL_OTHER,
  //   no disponibles para propinas y al final del orden; dos líneas con el
  //   mismo nombre comparten el medio. Se audita PAYMENT_METHOD_CREATED con
  //   el mismo detalle que POST /payment-methods.
  // - «Recordar» (SPRINT-4A-T18): asigna el ID Subway al local elegido solo
  //   si sigue sin uno (nunca lo sobrescribe) y crea los alias de los medios
  //   elegidos o creados.
  // Cada cambio se audita en la misma transacción, con el origen
  // sales_import.
  private async applyChoices(
    tx: Prisma.TransactionClient,
    plan: ManualResolutionPlan,
    currentUser: AuthUser,
    origin: SalesImportAuditOrigin,
  ): Promise<Map<number, string>> {
    const audit = {
      userId: currentUser.id,
      ipAddress: origin.ipAddress,
      userAgent: origin.userAgent?.slice(0, 255) ?? null,
    };
    if (plan.rememberSubwayStoreId !== null) {
      const assigned = await tx.store.updateMany({
        where: { id: plan.store.id, subwayStoreId: null },
        data: { subwayStoreId: plan.rememberSubwayStoreId },
      });
      if (assigned.count !== 1) {
        throw new ConflictException(
          `El local «${plan.store.name}» recibió un ID Subway mientras confirmabas: vuelve a cargar el archivo`,
        );
      }
      await tx.auditLog.create({
        data: {
          ...audit,
          action: AUDIT_ACTION.STORE_UPDATED,
          entityType: 'stores',
          entityId: plan.store.id,
          storeId: plan.store.id,
          detail: {
            previousSubwayStoreId: null,
            subwayStoreId: plan.rememberSubwayStoreId,
            source: 'sales_import',
          },
        },
      });
    }

    const methodIds = new Map<number, string>();
    const createdByCode = new Map<string, string>();
    for (const { line, target } of plan.lines) {
      if (target.kind === 'EXISTING') {
        methodIds.set(line.lineNumber, target.paymentMethodId);
        continue;
      }
      const reused = createdByCode.get(target.code);
      if (reused !== undefined) {
        methodIds.set(line.lineNumber, reused);
        continue;
      }
      const last = await tx.paymentMethod.aggregate({
        _max: { sortOrder: true },
      });
      const data = {
        code: target.code,
        name: target.name,
        sortOrder: Math.min(
          (last._max.sortOrder ?? 0) + NEW_METHOD_SORT_STEP,
          MAX_SORT_ORDER,
        ),
        behavior: NEW_METHOD_BEHAVIOR,
        availableForTips: false,
      };
      // Un medio con el mismo código creado al mismo tiempo choca con la
      // restricción única (409 en el llamador).
      const method = await tx.paymentMethod.create({
        data,
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          ...audit,
          action: AUDIT_ACTION.PAYMENT_METHOD_CREATED,
          entityType: 'payment_methods',
          entityId: method.id,
          storeId: null,
          detail: { ...data, source: 'sales_import' },
        },
      });
      createdByCode.set(target.code, method.id);
      methodIds.set(line.lineNumber, method.id);
    }

    for (const { line } of plan.lines.filter((planned) => planned.remember)) {
      const paymentMethodId = requireLineMethod(methodIds, line.lineNumber);
      const alias = await tx.paymentMethodAlias.create({
        data: {
          system: 'MRCOMANDA',
          label: line.originalLabel,
          normalizedLabel: line.normalizedLabel,
          paymentMethodId,
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          ...audit,
          action: AUDIT_ACTION.PAYMENT_METHOD_ALIAS_CREATED,
          entityType: 'payment_method_aliases',
          entityId: alias.id,
          storeId: null,
          detail: {
            system: 'MRCOMANDA',
            label: line.originalLabel,
            normalizedLabel: line.normalizedLabel,
            paymentMethodId,
            source: 'sales_import',
          },
        },
      });
    }
    return methodIds;
  }

  // Limpieza de un archivo que quedó sin importación (descarte, duplicado
  // concurrente o transacción fallida). Un fallo aquí no debe ocultar el
  // resultado ni el error original: se registra y se continúa.
  private async removeOrphanFile(relativePath: string): Promise<void> {
    try {
      await this.storage.remove(relativePath);
    } catch (error) {
      this.logger.warn(
        `No se pudo eliminar el archivo huérfano ${relativePath}: ${String(error)}`,
      );
    }
  }
}
