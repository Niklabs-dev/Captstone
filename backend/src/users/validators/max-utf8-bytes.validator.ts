import { registerDecorator, type ValidationOptions } from 'class-validator';

// Indica si el texto, codificado en UTF-8, no supera el máximo de bytes.
export function fitsUtf8Bytes(value: unknown, max: number): boolean {
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= max;
}

// Limita el largo en bytes UTF-8 (no en caracteres) de un campo de texto.
export function MaxUtf8Bytes(
  max: number,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'maxUtf8Bytes',
      target: target.constructor,
      propertyName: propertyName.toString(),
      constraints: [max],
      options: {
        message: `$property no puede superar ${max} bytes`,
        ...validationOptions,
      },
      validator: {
        validate: (value: unknown): boolean => fitsUtf8Bytes(value, max),
      },
    });
  };
}
