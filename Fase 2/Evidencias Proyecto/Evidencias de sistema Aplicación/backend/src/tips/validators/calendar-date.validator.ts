import { registerDecorator, type ValidationOptions } from 'class-validator';
import { parseCalendarDate } from '../../audit/utils/business-day.util.js';

export function isCalendarDate(value: unknown): value is string {
  return typeof value === 'string' && parseCalendarDate(value) !== null;
}

export function IsCalendarDate(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isCalendarDate',
      target: target.constructor,
      propertyName: propertyName.toString(),
      options: {
        message: '$property debe ser una fecha válida con formato YYYY-MM-DD',
        ...validationOptions,
      },
      validator: {
        validate: (value: unknown): boolean => isCalendarDate(value),
      },
    });
  };
}
