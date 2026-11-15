import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { formatDbDate } from '../documents/utils/document-dates.util.js';
import { InventoryCountStatus, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { writeWorkbook } from '../tips/export/daily-tips-xlsx.writer.js';
import {
  buildInventoryCountWorkbook,
  buildInventoryFileName,
  countTotals,
  InvalidTemplateSnapshotError,
  parseTemplateSnapshot,
} from './export/inventory-count-workbook.js';
import type {
  InventoryCountExportFile,
  InventoryTemplateSnapshotRow,
} from './types/inventory-counts.types.js';

// Descarga en Excel de una toma de inventario finalizada (SPRINT-5-T08).
// Exclusiva del ADMINISTRADOR (el guard de roles del controller lo exige), de
// cualquier local. Una toma En curso responde 409: su contenido todavía puede
// cambiar. El archivo se arma con la copia de la plantilla y de cada producto
// que guardó la finalización, así no cambia aunque después se edite el
// catálogo o la plantilla.

const EXPORT_COUNT_SELECT = {
  id: true,
  status: true,
  countDate: true,
  finalizedAt: true,
  templateSnapshot: true,
  store: { select: { id: true, name: true } },
  lines: {
    select: {
      productId: true,
      productName: true,
      unit: true,
      looseOnly: true,
      boxes: true,
      packages: true,
      looseQuantity: true,
      countedQuantity: true,
      boxContent: true,
      packageContent: true,
    },
  },
} satisfies Prisma.InventoryCountSelect;

@Injectable()
export class InventoryCountExportService {
  private readonly logger = new Logger(InventoryCountExportService.name);

  constructor(private readonly prisma: PrismaService) {}

  async exportCount(id: string): Promise<InventoryCountExportFile> {
    const count = await this.prisma.inventoryCount.findUnique({
      where: { id },
      select: EXPORT_COUNT_SELECT,
    });
    if (!count) throw new NotFoundException('Toma de inventario no encontrada');
    // El CHECK de inventory_counts asegura que una toma CONFIRMED tiene
    // finalizedAt y templateSnapshot.
    if (
      count.status !== InventoryCountStatus.CONFIRMED ||
      count.finalizedAt === null
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
      snapshot: this.readSnapshot(count.id, count.templateSnapshot),
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

  // Una copia corrupta no es culpa de quien descarga: se registra en el log
  // con la toma afectada y se responde 500 con un mensaje claro.
  private readSnapshot(
    countId: string,
    value: unknown,
  ): InventoryTemplateSnapshotRow[] {
    try {
      return parseTemplateSnapshot(value);
    } catch (error) {
      if (!(error instanceof InvalidTemplateSnapshotError)) throw error;
      this.logger.error(
        `No se pudo exportar la toma ${countId}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'La copia de la plantilla guardada en la toma está dañada; no se puede generar el Excel',
      );
    }
  }
}
