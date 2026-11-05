import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildClosingInput,
  chileTimestamp,
  closingErrorMessage,
  closingFieldErrors,
  closingPeriod,
  emptyClosingFields,
  parseClosingInput,
  periodsMismatch,
  previewVouchers,
  publicClosingErrorCode,
  selectedTipTotal,
  type ClosingFields,
} from './cash-closing-form';
import { getMobileNavigation, getNavigationIcon } from './mobile-navigation';
import { getNavigationItems, getPageRedirect } from './navigation';
import { ROLES } from './auth';

const TIP_ID = 'a9000000-0000-4000-8000-000000000030';
const TIPS = [{ id: TIP_ID, paymentMethod: 'DEBIT_CARD', amount: 31602 }];

// Caso real de vouchers del tablero (E3-H1): descuadre de 1.600 y fondo 31.602.
function voucherCase(): ClosingFields {
  return {
    ...emptyClosingFields('2026-03-10'),
    shift: '1',
    openingCash: '50000',
    counted: {
      CASH: '150000',
      DEBIT_CARD: '511730',
      CREDIT_CARD: '43800',
      TRANSFER: '0',
    },
    mrcomandaStart: '08:00',
    mrcomandaEnd: '16:00',
    mrcomandaDebit: '511730',
    mrcomandaCredit: '43800',
    mercadoPagoStart: '08:00',
    mercadoPagoEnd: '16:00',
    mercadoPagoDebit: '517012',
    mercadoPagoCredit: '71720',
    mercadoPagoTips: '31602',
    tipEntryIds: [TIP_ID],
    differenceReason: 'Diferencia de 1.600 en conciliación de vouchers.',
  };
}

test('La conciliación usa bruto − PROPINAS y deja visible el descuadre de 1.600', () => {
  assert.deepEqual(previewVouchers(voucherCase()), {
    mrcomandaNetSales: 555530,
    mercadoPagoGrossAmount: 588732,
    mercadoPagoTipAmount: 31602,
    mercadoPagoNetSales: 557130,
    reconciliationDifference: 1600,
  });
});

test('El caso de vouchers es válido y arma el cuerpo esperado por la API', () => {
  const fields = voucherCase();
  assert.deepEqual(closingFieldErrors(fields, TIPS), {});
  const input = buildClosingInput(fields);
  assert.ok(input);
  assert.deepEqual(
    input.lines.map((line) => line.paymentMethod),
    ['CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'TRANSFER'],
  );
  const mrcomanda = input.vouchers.filter((v) => v.source === 'MRCOMANDA');
  const mercadoPago = input.vouchers.filter((v) => v.source === 'MERCADO_PAGO');
  assert.deepEqual(
    mrcomanda.map((v) => [v.reference, v.amount, v.tipIncludedAmount]),
    [
      ['T. DÉBITO', 511730, 0],
      ['T. CRÉDITO', 43800, 0],
    ],
  );
  assert.equal(mercadoPago.length, 1);
  assert.equal(mercadoPago[0].amount, 588732);
  assert.equal(mercadoPago[0].tipIncludedAmount, 31602);
  assert.equal(mercadoPago[0].periodStart, '2026-03-10T08:00:00-03:00');
  assert.equal(mercadoPago[0].periodEnd, '2026-03-10T16:00:00-03:00');
  assert.deepEqual(input.tipEntryIds, [TIP_ID]);
  // La ruta del servidor acepta exactamente lo que arma el formulario.
  assert.deepEqual(parseClosingInput(JSON.parse(JSON.stringify(input))), input);
});

test('El descuadre de vouchers exige motivo antes de confirmar', () => {
  const errors = closingFieldErrors(
    { ...voucherCase(), differenceReason: '   ' },
    TIPS,
  );
  assert.ok(errors.differenceReason);
  const balanced = {
    ...voucherCase(),
    mercadoPagoTips: '33202',
    differenceReason: '',
  };
  assert.equal(previewVouchers(balanced).reconciliationDifference, 0);
  assert.equal(
    closingFieldErrors(balanced, [{ ...TIPS[0], amount: 33202 }])
      .differenceReason,
    undefined,
  );
});

test('Las propinas vinculadas deben sumar exactamente PROPINAS', () => {
  assert.equal(selectedTipTotal(TIPS, [TIP_ID]), 31602);
  assert.equal(selectedTipTotal(TIPS, []), 0);
  assert.ok(
    closingFieldErrors({ ...voucherCase(), tipEntryIds: [] }, TIPS).tipEntryIds,
  );
  assert.match(
    closingFieldErrors(voucherCase(), []).tipEntryIds ?? '',
    /Propinas diarias/,
  );
  // Sin PROPINAS no se exige vincular registros.
  assert.equal(
    closingFieldErrors(
      {
        ...voucherCase(),
        mercadoPagoTips: '0',
        mercadoPagoDebit: '511730',
        mercadoPagoCredit: '43800',
        tipEntryIds: [],
      },
      [],
    ).tipEntryIds,
    undefined,
  );
});

test('Se advierte cuando los cortes de MrComanda y Mercado Pago no coinciden', () => {
  const fields = { ...voucherCase(), mercadoPagoEnd: '16:30' };
  assert.equal(periodsMismatch(fields), true);
  assert.ok(closingFieldErrors(fields, TIPS).mercadoPagoStart);
  assert.equal(periodsMismatch(voucherCase()), false);
});

test('Rechaza montos inválidos, PROPINAS mayor al bruto y turno fuera de rango', () => {
  const errors = closingFieldErrors(
    {
      ...voucherCase(),
      shift: '0',
      openingCash: '1.000',
      counted: { ...voucherCase().counted, CASH: '-5' },
      mercadoPagoTips: '999999999',
    },
    TIPS,
  );
  assert.ok(errors.shift);
  assert.ok(errors.openingCash);
  assert.ok(errors['counted.CASH']);
  assert.ok(errors.mercadoPagoTips);
  assert.ok(
    closingFieldErrors(emptyClosingFields('2026-03-10'), []).mrcomandaStart,
  );
});

test('Las horas se envían con la zona de Chile, incluido el horario de verano', () => {
  assert.equal(
    chileTimestamp('2026-07-15', '08:00'),
    '2026-07-15T08:00:00-04:00',
  );
  assert.equal(
    chileTimestamp('2026-01-15', '08:00'),
    '2026-01-15T08:00:00-03:00',
  );
  assert.equal(chileTimestamp('2026-02-30', '08:00'), null);
  assert.deepEqual(closingPeriod('2026-03-10', '16:00', '00:00'), {
    periodStart: '2026-03-10T16:00:00-03:00',
    periodEnd: '2026-03-11T00:00:00-03:00',
  });
  assert.equal(closingPeriod('2026-03-10', '16:00', '15:00'), null);
});

test('La ruta rechaza cuerpos con campos extra, local o montos inválidos', () => {
  const input = buildClosingInput(voucherCase());
  assert.ok(input);
  const body = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  assert.equal(parseClosingInput({ ...body, storeId: TIP_ID }), null);
  assert.equal(parseClosingInput({ ...body, openingCash: -1 }), null);
  assert.equal(
    parseClosingInput({ ...body, tipEntryIds: [TIP_ID, TIP_ID] }),
    null,
  );
  assert.equal(
    parseClosingInput({
      ...body,
      lines: [
        { paymentMethod: 'CASH', countedAmount: 1 },
        { paymentMethod: 'CASH', countedAmount: 2 },
      ],
    }),
    null,
  );
  assert.equal(parseClosingInput(null), null);
});

test('Solo los mensajes conocidos del backend se exponen al supervisor', () => {
  assert.equal(
    publicClosingErrorCode(
      'differenceReason es obligatorio cuando existe una diferencia',
    ),
    'REASON_REQUIRED',
  );
  assert.equal(publicClosingErrorCode('Error interno con detalles'), null);
  assert.match(closingErrorMessage(409, 'CLOSING_EXISTS'), /cierre existente/);
  assert.match(closingErrorMessage(500), /verificar/);
});

test('Cierre de caja es exclusivo del supervisor en navegación y acceso directo', () => {
  for (const role of ROLES) {
    const allowed = role === 'SUPERVISOR';
    assert.equal(
      getNavigationItems(role).some((item) => item.href === '/cierres-caja'),
      allowed,
    );
    assert.equal(
      getPageRedirect(role, '/cierres-caja'),
      allowed
        ? null
        : role === 'TRABAJADOR'
          ? '/portal?reason=forbidden'
          : '/dashboard?reason=forbidden',
    );
  }
  const { primary } = getMobileNavigation('SUPERVISOR');
  assert.ok(primary.some((item) => item.href === '/cierres-caja'));
  assert.equal(getNavigationIcon('/cierres-caja'), 'wallet');
});
