import {
  isValidPaymentMethodCode,
  normalizePaymentMethodCode,
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
