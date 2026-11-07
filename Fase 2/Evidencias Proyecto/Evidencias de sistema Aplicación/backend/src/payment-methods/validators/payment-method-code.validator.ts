import { registerDecorator, type ValidationOptions } from 'class-validator';
import { isValidPaymentMethodCode } from '../utils/payment-method-code.util.js';

export function isPaymentMethodCode(value: unknown): value is string {
  return typeof value === 'string' && isValidPaymentMethodCode(value);
}

// Valida el código estable de un medio de pago (SPRINT-4-T32): UPPER_SNAKE
// normalizado, con letras, dígitos y guiones bajos simples.
export function IsPaymentMethodCode(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isPaymentMethodCode',
      target: target.constructor,
      propertyName: propertyName.toString(),
      options: {
        message:
          '$property debe ser un código en mayúsculas con letras, dígitos y guiones bajos simples',
        ...validationOptions,
      },
      validator: {
        validate: (value: unknown): boolean => isPaymentMethodCode(value),
      },
    });
  };
}
