import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { canAccessStore } from '../auth/policies/store-access.policy.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import { UPLOADABLE_DOCUMENT_TYPES } from '../documents/types/documents.types.js';
import { formatDbDate } from '../documents/utils/document-dates.util.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RegisterDtDto } from './dto/register-dt.dto.js';
import type {
  DtAlert,
  DtAlertCollection,
  DtRegistrationResponse,
} from './types/dt-alerts.types.js';
import {
  daysUntilDeadline,
  documentRevision,
  dtAlertStatus,
} from './utils/dt-deadline.util.js';

// Documentos laborales del gestor documental cuyo tipo exige registro en la
// DT (CONTRATO, ANEXO y FINIQUITO, SPRINT-2-T03): tienen plazo fijado al
// cargarlos (SPRINT-2-T05).
const DT_DOCUMENT_WHERE = {
  documentType: { code: { in: [...UPLOADABLE_DOCUMENT_TYPES] } },
  subjectUserId: { not: null },
  currentVersionId: { not: null },
  dtRegistrationDueAt: { not: null },
} satisfies Prisma.DocumentWhereInput;

const ALERT_INCLUDE = {
  documentType: { select: { code: true } },
  subjectUser: { select: { id: true, firstName: true, lastName: true } },
  store: { select: { id: true, name: true } },
} satisfies Prisma.DocumentInclude;

type AlertDocument = Prisma.DocumentGetPayload<{
  include: typeof ALERT_INCLUDE;
}>;

const ALERT_NOT_FOUND_MESSAGE =
  'No existe una alerta de registro en la DT para este documento';

// Alertas del plazo de 15 días para registrar documentos laborales en la
// Dirección del Trabajo (SPRINT-2-T08): las calcula a partir de los
// documentos pendientes y permite marcar el registro como realizado.
@Injectable()
export class DtAlertsService {
  constructor(private readonly prisma: PrismaService) {}

  // Documentos sin registrar en la DT, vencidos y próximos a vencer: como el
  // plazo es de 15 días, todo documento pendiente está a lo más a 15 días de
  // vencer. Primero los vencidos, luego los más próximos.
  async list(currentUser: AuthUser): Promise<DtAlertCollection> {
    const documents = await this.prisma.document.findMany({
      where: { ...DT_DOCUMENT_WHERE, dtRegisteredAt: null },
      include: ALERT_INCLUDE,
      orderBy: [
        { dtRegistrationDueAt: 'asc' },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
    });
    const calculatedAt = new Date();
    return {
      items: documents
        .filter((document) => canAccessStore(currentUser, document.storeId))
        .map((document) => toDtAlert(document, calculatedAt)),
      calculatedAt,
    };
  }

  // Marca el documento como registrado en la DT, con quién y cuándo. Solo si
  // sigue pendiente y no cambió desde que se consultó la alerta (revision):
  // si no, 409 para que el usuario actualice el panel.
  async register(
    alertId: string,
    dto: RegisterDtDto,
    currentUser: AuthUser,
  ): Promise<DtRegistrationResponse> {
    if (dto.documentId !== alertId) {
      throw new BadRequestException(
        'documentId no corresponde a la alerta indicada',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Bloquea la fila hasta el fin de la transacción: dos confirmaciones
      // simultáneas se serializan y la segunda ve el registro de la primera.
      await tx.$queryRaw`SELECT id FROM documents WHERE id = ${alertId}::uuid FOR UPDATE`;
      const document = await tx.document.findFirst({
        where: { id: alertId, ...DT_DOCUMENT_WHERE },
      });
      if (!document || !canAccessStore(currentUser, document.storeId)) {
        throw new NotFoundException(ALERT_NOT_FOUND_MESSAGE);
      }
      if (document.dtRegisteredAt !== null) {
        throw new ConflictException('El documento ya fue registrado en la DT');
      }
      if (documentRevision(document.updatedAt) !== dto.revision) {
        throw new ConflictException(
          'El documento cambió desde que se consultó la alerta; actualiza el panel',
        );
      }

      const registered = await tx.document.update({
        where: { id: alertId },
        data: { dtRegisteredAt: new Date(), dtRegisteredById: currentUser.id },
      });
      return {
        alertId,
        documentId: registered.id,
        status: 'REGISTERED',
        // dtRegisteredAt acaba de fijarse.
        registeredAt: registered.dtRegisteredAt ?? new Date(),
      };
    });
  }
}

function toDtAlert(document: AlertDocument, now: Date): DtAlert {
  // DT_DOCUMENT_WHERE garantiza plazo y trabajador.
  const deadline = document.dtRegistrationDueAt;
  const worker = document.subjectUser;
  if (deadline === null || worker === null) {
    throw new Error(`El documento ${document.id} no tiene plazo o trabajador`);
  }
  const daysRemaining = daysUntilDeadline(deadline, now);
  return {
    id: document.id,
    documentId: document.id,
    documentType: document.documentType.code,
    contractTitle: document.title,
    worker: { id: worker.id, name: `${worker.firstName} ${worker.lastName}` },
    store: document.store,
    deadline: formatDbDate(deadline),
    daysRemaining,
    status: dtAlertStatus(daysRemaining),
    revision: documentRevision(document.updatedAt),
    canRegister: true,
  };
}
