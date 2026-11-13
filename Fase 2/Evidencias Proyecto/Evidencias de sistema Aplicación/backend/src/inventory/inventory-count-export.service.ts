import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { STORE_FORBIDDEN_MESSAGE } from '../auth/constants/forbidden-messages.constants.js';
import { canAccessStore } from '../auth/policies/store-access.policy.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import { formatDbDate } from '../documents/utils/document-dates.util.js';
import { InventoryCountStatus, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { writeWorkbook } from '../tips/export/daily-tips-xlsx.writer.js';
import {
  buildInventoryCountWorkbook,
  buildInventoryFileName,
  countTotals,
  parseTemplateSnapshot,
} from './export/inventory-count-workbook.js';
import type { InventoryCountExportFile } from './types/inventory-counts.types.js';

// Descarga en Excel de una toma de inventario finalizada (SPRINT-5-T08). El
// ADMINISTRADOR descarga la de cualquier local y el SUPERVISOR solo la de su
// local (mismo acceso que GET /inventory-counts/:id). Una toma En curso
// responde 409: su contenido todavía puede cambiar. El archivo se arma con la
// copia de la plantilla y de cada producto que guardó la finalización, así no
// cambia aunque después se edite el catálogo o la plantilla.

const PERSON_SELECT = {
  firstName: true,
  lastName: true,
} satisfies Prisma.UserSelect;

const EXPORT_COUNT_SELECT = {
  id: true,
  status: true,
  countDate: true,
  countedAt: true,
  finalizedAt: true,
  templateSnapshot: true,
  storeId: true,
  store: { select: { id: true, name: true } },
  createdBy: { select: PERSON_SELECT },
  finalizedBy: { select: PERSON_SELECT },
  lines: {
    select: {
      productId: true,
      productName: true,
      boxes: true,
      packages: true,
      looseQuantity: true,
      countedQuantity: true,
      boxContent: true,
      packageContent: true,
    },
  },
} satisfies Prisma.InventoryCountSelect;

function fullName(person: { firstName: string; lastName: string }): string {
  return `${person.firstName} ${person.lastName}`.trim();
}

@Injectable()
export class InventoryCountExportService {
  constructor(private readonly prisma: PrismaService) {}

  async exportCount(
    id: string,
    user: AuthUser,
  ): Promise<InventoryCountExportFile> {
    const count = await this.prisma.inventoryCount.findUnique({
      where: { id },
      select: EXPORT_COUNT_SELECT,
    });
    if (!count) throw new NotFoundException('Toma de inventario no encontrada');
    if (!canAccessStore(user, count.storeId)) {
      throw new ForbiddenException(STORE_FORBIDDEN_MESSAGE);
    }
    // El CHECK de inventory_counts asegura que una toma CONFIRMED tiene
    // finalizedAt, finalizedBy y templateSnapshot; se revisa igual para que
    // TypeScript los trate como presentes.
    if (
      count.status !== InventoryCountStatus.CONFIRMED ||
      count.finalizedAt === null ||
      count.finalizedBy === null
    ) {
      throw new ConflictException({
        statusCode: 409,
        message: 'La toma de inventario todavía está en curso',
        errors: {
          countId: 'Solo se descarga en Excel una toma finalizada',
        },
      });
    }

    const countDate = formatDbDate(count.countDate);
    const sheets = buildInventoryCountWorkbook({
      storeName: count.store.name,
      countDate,
      startedAt: count.countedAt,
      startedBy: fullName(count.createdBy),
      finalizedAt: count.finalizedAt,
      finalizedBy: fullName(count.finalizedBy),
      snapshot: parseTemplateSnapshot(count.templateSnapshot),
      lines: count.lines,
    });
    return {
      countId: count.id,
      store: count.store,
      countDate,
      fileName: buildInventoryFileName(count.store.name, countDate),
      content: await writeWorkbook(sheets),
      ...countTotals(count.lines),
    };
  }
}
