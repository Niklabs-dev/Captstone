import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { normalizeExternalLabel } from '../../sales-imports/normalization/normalize-external-label.js';
import type { CreatePaymentMethodAliasDto } from './payment-method-alias.dto.js';
import type { PaymentMethodAliasResponse } from './payment-method-aliases.types.js';

// Administración de los alias de medios de pago de los informes
// (SPRINT-4A-T20): listar, crear y eliminar. Corregir un alias equivocado es
// eliminarlo y crearlo hacia el medio correcto. Las importaciones ya
// guardadas no cambian: cada línea conserva su etiqueta original y el medio
// con que se confirmó.

const ALIAS_SELECT = {
  id: true,
  system: true,
  label: true,
  normalizedLabel: true,
  createdAt: true,
  paymentMethod: {
    select: { id: true, code: true, name: true, isActive: true },
  },
} satisfies Prisma.PaymentMethodAliasSelect;

type AliasRecord = Prisma.PaymentMethodAliasGetPayload<{
  select: typeof ALIAS_SELECT;
}>;

function toResponse(alias: AliasRecord): PaymentMethodAliasResponse {
  return {
    id: alias.id,
    system: alias.system,
    label: alias.label,
    normalizedLabel: alias.normalizedLabel,
    paymentMethod: alias.paymentMethod,
    createdAt: alias.createdAt,
  };
}

@Injectable()
export class PaymentMethodAliasesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<PaymentMethodAliasResponse[]> {
    const aliases = await this.prisma.paymentMethodAlias.findMany({
      where: { system: 'MRCOMANDA' },
      orderBy: [
        { paymentMethod: { sortOrder: 'asc' } },
        { normalizedLabel: 'asc' },
      ],
      select: ALIAS_SELECT,
    });
    return aliases.map(toResponse);
  }

  async create(
    dto: CreatePaymentMethodAliasDto,
  ): Promise<PaymentMethodAliasResponse> {
    const normalizedLabel = normalizeExternalLabel(dto.label);
    if (normalizedLabel === '') {
      throw new BadRequestException('label no puede estar vacío');
    }
    const method = await this.prisma.paymentMethod.findUnique({
      where: { id: dto.paymentMethodId },
      select: { isActive: true, name: true },
    });
    if (!method) {
      throw new NotFoundException('Medio de pago no encontrado');
    }
    if (!method.isActive) {
      throw new BadRequestException(
        `El medio «${method.name}» está inactivo: reactívalo antes de asociarle etiquetas`,
      );
    }
    await this.ensureLabelAvailable(normalizedLabel);
    try {
      const alias = await this.prisma.paymentMethodAlias.create({
        data: {
          system: 'MRCOMANDA',
          label: dto.label,
          normalizedLabel,
          paymentMethodId: dto.paymentMethodId,
        },
        select: ALIAS_SELECT,
      });
      return toResponse(alias);
    } catch (error) {
      // Alta simultánea de la misma etiqueta: la restricción única decide.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        await this.ensureLabelAvailable(normalizedLabel);
      }
      throw error;
    }
  }

  async remove(id: string): Promise<PaymentMethodAliasResponse> {
    const alias = await this.prisma.paymentMethodAlias.findUnique({
      where: { id },
      select: ALIAS_SELECT,
    });
    if (!alias) {
      throw new NotFoundException('Alias de medio de pago no encontrado');
    }
    await this.prisma.paymentMethodAlias.delete({ where: { id } });
    return toResponse(alias);
  }

  // Una etiqueta normalizada resuelve un único medio (único por sistema).
  private async ensureLabelAvailable(normalizedLabel: string): Promise<void> {
    const existing = await this.prisma.paymentMethodAlias.findUnique({
      where: {
        system_normalizedLabel: { system: 'MRCOMANDA', normalizedLabel },
      },
      select: { label: true, paymentMethod: { select: { name: true } } },
    });
    if (existing) {
      throw new ConflictException(
        `La etiqueta «${existing.label}» ya está asociada a «${existing.paymentMethod.name}». Quítala de ese medio antes de asociarla a otro.`,
      );
    }
  }
}
