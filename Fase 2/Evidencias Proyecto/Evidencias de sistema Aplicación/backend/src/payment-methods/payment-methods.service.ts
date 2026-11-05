import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreatePaymentMethodDto } from './dto/create-payment-method.dto.js';
import type { ListPaymentMethodsQueryDto } from './dto/list-payment-methods-query.dto.js';
import type { UpdatePaymentMethodDto } from './dto/update-payment-method.dto.js';
import type {
  PaymentMethodResponse,
  PaymentMethodStateChange,
} from './types/payment-methods.types.js';
import { isValidPaymentMethodCode } from './utils/payment-method-code.util.js';

const PAYMENT_METHOD_SELECT = {
  id: true,
  code: true,
  name: true,
  sortOrder: true,
  isActive: true,
  behavior: true,
  availableForTips: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PaymentMethodSelect;

type PaymentMethodRecord = Prisma.PaymentMethodGetPayload<{
  select: typeof PAYMENT_METHOD_SELECT;
}>;

function toPaymentMethodResponse(
  paymentMethod: PaymentMethodRecord,
): PaymentMethodResponse {
  return {
    id: paymentMethod.id,
    code: paymentMethod.code,
    name: paymentMethod.name,
    sortOrder: paymentMethod.sortOrder,
    isActive: paymentMethod.isActive,
    behavior: paymentMethod.behavior,
    availableForTips: paymentMethod.availableForTips,
    createdAt: paymentMethod.createdAt,
    updatedAt: paymentMethod.updatedAt,
  };
}

@Injectable()
export class PaymentMethodsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    query: ListPaymentMethodsQueryDto,
  ): Promise<PaymentMethodResponse[]> {
    const paymentMethods = await this.prisma.paymentMethod.findMany({
      where: {
        isActive: query.isActive,
        availableForTips: query.availableForTips,
      },
      select: PAYMENT_METHOD_SELECT,
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    return paymentMethods.map(toPaymentMethodResponse);
  }

  async create(dto: CreatePaymentMethodDto): Promise<PaymentMethodResponse> {
    const code = dto.code;
    if (!isValidPaymentMethodCode(code)) {
      throw new BadRequestException(
        'code debe ser un código en mayúsculas con letras, dígitos y guiones bajos simples',
      );
    }
    await this.ensureCodeAvailable(code);

    try {
      const paymentMethod = await this.prisma.paymentMethod.create({
        data: {
          code,
          name: dto.name,
          sortOrder: dto.sortOrder,
          behavior: dto.behavior,
          availableForTips: dto.availableForTips,
        },
        select: PAYMENT_METHOD_SELECT,
      });
      return toPaymentMethodResponse(paymentMethod);
    } catch (error) {
      this.handleWriteError(error);
    }
  }

  async update(
    id: string,
    dto: UpdatePaymentMethodDto,
  ): Promise<PaymentMethodResponse> {
    await this.findById(id);
    const data: Prisma.PaymentMethodUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.behavior !== undefined) data.behavior = dto.behavior;
    if (dto.availableForTips !== undefined) {
      data.availableForTips = dto.availableForTips;
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException(
        'Debes indicar al menos un campo para actualizar el medio de pago',
      );
    }

    const paymentMethod = await this.prisma.paymentMethod.update({
      where: { id },
      data,
      select: PAYMENT_METHOD_SELECT,
    });
    return toPaymentMethodResponse(paymentMethod);
  }

  async deactivate(id: string): Promise<PaymentMethodStateChange> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM payment_methods WHERE id = ${id}::uuid FOR UPDATE`;
      const existing = await this.findById(id, tx);
      if (!existing.isActive) {
        return {
          paymentMethod: toPaymentMethodResponse(existing),
          changed: false,
        };
      }

      const paymentMethod = await tx.paymentMethod.update({
        where: { id },
        data: { isActive: false },
        select: PAYMENT_METHOD_SELECT,
      });
      return {
        paymentMethod: toPaymentMethodResponse(paymentMethod),
        changed: true,
      };
    });
  }

  async reactivate(id: string): Promise<PaymentMethodStateChange> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM payment_methods WHERE id = ${id}::uuid FOR UPDATE`;
      const existing = await this.findById(id, tx);
      if (existing.isActive) {
        return {
          paymentMethod: toPaymentMethodResponse(existing),
          changed: false,
        };
      }

      const paymentMethod = await tx.paymentMethod.update({
        where: { id },
        data: { isActive: true },
        select: PAYMENT_METHOD_SELECT,
      });
      return {
        paymentMethod: toPaymentMethodResponse(paymentMethod),
        changed: true,
      };
    });
  }

  private async findById(
    id: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<PaymentMethodRecord> {
    const paymentMethod = await client.paymentMethod.findUnique({
      where: { id },
      select: PAYMENT_METHOD_SELECT,
    });
    if (!paymentMethod) {
      throw new NotFoundException('Medio de pago no encontrado');
    }
    return paymentMethod;
  }

  private async ensureCodeAvailable(code: string): Promise<void> {
    const existing = await this.prisma.paymentMethod.findUnique({
      where: { code },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Ya existe un medio de pago con ese código');
    }
  }

  private handleWriteError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Ya existe un medio de pago con ese código');
    }
    throw error;
  }
}
