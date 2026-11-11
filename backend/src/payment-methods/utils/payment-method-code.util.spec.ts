import {
  isValidPaymentMethodCode,
  normalizePaymentMethodCode,
  PAYMENT_METHOD_CODE_MAX_LENGTH,
  paymentMethodCodeFromName,
} from './payment-method-code.util.js';

describe('normalizePaymentMethodCode', () => {
  it('convierte a mayúsculas y reemplaza espacios y guiones por guion bajo', () => {
    expect(normalizePaymentMethodCode('debit card')).toBe('DEBIT_CARD');
    expect(normalizePaymentMethodCode('  Junaeb ')).toBe('JUNAEB');
    expect(normalizePaymentMethodCode('tarjeta-crédito')).toBe(
      'TARJETA_CRÉDITO',
    );
  });

  it('colapsa guiones bajos repetidos y los recorta en los extremos', () => {
    expect(normalizePaymentMethodCode('__credito__otro__')).toBe(
      'CREDITO_OTRO',
    );
    expect(normalizePaymentMethodCode(' - transfer - ')).toBe('TRANSFER');
  });
});

describe('isValidPaymentMethodCode', () => {
  it.each(['CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'TRANSFER', 'A1'])(
    'acepta el código válido %s',
    (code) => {
      expect(isValidPaymentMethodCode(code)).toBe(true);
    },
  );

  it.each([
    'A', // demasiado corto
    '1', // sin letras
    '12345', // puramente numérico
    'CASH$', // carácter no permitido
    '_CASH', // empieza con guion bajo
    'CASH_', // termina con guion bajo
    'CASH__CARD', // doble guion bajo
    'CASH CARD', // espacios sin normalizar
    `${'A'.repeat(41)}`, // excede el largo máximo
  ])('rechaza el código inválido %s', (code) => {
    expect(isValidPaymentMethodCode(code)).toBe(false);
  });

  it('un código normalizado pasa la validación', () => {
    expect(
      isValidPaymentMethodCode(normalizePaymentMethodCode(' tarjeta debito ')),
    ).toBe(true);
  });
});

describe('paymentMethodCodeFromName (SPRINT-4A-T21)', () => {
  it('deriva un código válido del nombre: sin tildes, mayúsculas y "_"', () => {
    expect(paymentMethodCodeFromName('N.de Créd.')).toBe('N_DE_CRED');
    expect(paymentMethodCodeFromName('  Cupón  Ñuñoa ')).toBe('CUPON_NUNOA');
    expect(paymentMethodCodeFromName('Pago-QR 2')).toBe('PAGO_QR_2');
    expect(
      isValidPaymentMethodCode(paymentMethodCodeFromName('N.de Créd.')),
    ).toBe(true);
  });

  it('recorta al largo máximo sin dejar un "_" al final', () => {
    const code = paymentMethodCodeFromName(`${'A'.repeat(39)} B`);
    expect(code).toBe('A'.repeat(39));
    expect(code.length).toBeLessThanOrEqual(PAYMENT_METHOD_CODE_MAX_LENGTH);
  });

  it('un nombre sin letras ASCII ni dígitos no produce un código válido', () => {
    expect(isValidPaymentMethodCode(paymentMethodCodeFromName('ÆØ'))).toBe(
      false,
    );
    expect(isValidPaymentMethodCode(paymentMethodCodeFromName('123'))).toBe(
      false,
    );
  });
});
