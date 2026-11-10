import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { DailyTipsService } from './daily-tips.service.js';
import type { DailyTipsRangeQueryDto } from './dto/daily-tips-query.dto.js';
import {
  buildDailyTipsWorkbook,
  buildExportFileName,
} from './export/daily-tips-workbook.js';
import { writeWorkbook } from './export/daily-tips-xlsx.writer.js';
import type { DailyTipsExportFile } from './types/daily-tips.types.js';

// Exportación a Excel de las propinas del período (SPRINT-4A-T05): hoja
// «Resumen» (trabajador × día con totales) y hoja «Detalle» (una fila por
// propina diaria). Reutiliza la validación del rango, la lectura de propinas
// y la agregación de la consulta (SPRINT-4A-T04), así los montos cuadran con
// GET /daily-tips/summary. Solo ADMINISTRADOR y CONTADOR (roles globales,
// lo aplica el controller), por eso no hay control de local aquí. El RUT
// solo se lee para el archivo: la API de consulta nunca lo expone.
@Injectable()
export class DailyTipsExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dailyTips: DailyTipsService,
  ) {}

  async exportPeriod(
    query: DailyTipsRangeQueryDto,
  ): Promise<DailyTipsExportFile> {
    const range = this.dailyTips.parseRange(query.from, query.to);
    const store = await this.dailyTips.findStore(query.storeId);
    const allocations = await this.dailyTips.findAllocations(
      query.storeId,
      range,
    );
    const workerIds = [...new Set(allocations.map((tip) => tip.worker.id))];
    const workers =
      workerIds.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: workerIds } },
            select: { id: true, rut: true },
          })
        : [];
    const sheets = buildDailyTipsWorkbook({
      from: range.from,
      to: range.to,
      allocations,
      rutByWorker: new Map(workers.map((worker) => [worker.id, worker.rut])),
    });
    return {
      store,
      from: range.from,
      to: range.to,
      fileName: buildExportFileName(store.name, range.from, range.to),
      content: await writeWorkbook(sheets),
      workerCount: workerIds.length,
      allocationCount: allocations.length,
    };
  }
}
