import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateUserDto } from '../dto/create-user.dto.js';
import { ResetPasswordDto } from '../dto/reset-password.dto.js';
import { fitsUtf8Bytes, MaxUtf8Bytes } from './max-utf8-bytes.validator.js';

class SampleDto {
  @MaxUtf8Bytes(4)
  value: unknown;
}

function constraintMessages(dto: object): string[] {
  return validateSync(dto).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );
}

function resetPasswordErrors(newPassword: unknown): string[] {
  return constraintMessages(plainToInstance(ResetPasswordDto, { newPassword }));
}

describe('MaxUtf8Bytes', () => {
  it('mide bytes UTF-8 y no caracteres', () => {
    expect(fitsUtf8Bytes('abcd', 4)).toBe(true);
    expect(fitsUtf8Bytes('abcde', 4)).toBe(false);
    // 'á' ocupa 2 bytes: 2 caracteres = 4 bytes, 3 caracteres = 6 bytes.
    expect(fitsUtf8Bytes('áá', 4)).toBe(true);
    expect(fitsUtf8Bytes('ááa', 4)).toBe(false);
  });

  it('rechaza valores que no son texto', () => {
    expect(fitsUtf8Bytes(1234, 4)).toBe(false);
    expect(fitsUtf8Bytes(undefined, 4)).toBe(false);
  });

  it('informa el campo y el máximo en el mensaje', () => {
    expect(
      constraintMessages(plainToInstance(SampleDto, { value: 'abcde' })),
    ).toEqual(['value no puede superar 4 bytes']);
    expect(
      constraintMessages(plainToInstance(SampleDto, { value: 'abcd' })),
    ).toEqual([]);
  });
});

describe('Política de contraseña en los DTO', () => {
  it('acepta 32 caracteres ASCII y rechaza 33', () => {
    expect(resetPasswordErrors('a'.repeat(32))).toEqual([]);
    expect(resetPasswordErrors('a'.repeat(33))).not.toEqual([]);
  });

  it('acepta 72 bytes y rechaza 75 aunque tenga menos de 32 caracteres', () => {
    // 'あ' ocupa 3 bytes: 24 caracteres = 72 bytes, 25 caracteres = 75 bytes.
    expect(resetPasswordErrors('あ'.repeat(24))).toEqual([]);
    expect(resetPasswordErrors('あ'.repeat(25))).toEqual([
      'newPassword no puede superar 72 bytes',
    ]);
  });

  it('aplica el mismo límite de bytes al alta, con el nombre de su campo', () => {
    const dto = plainToInstance(CreateUserDto, {
      email: 'ana@moi-food.cl',
      password: 'あ'.repeat(25),
      firstName: 'Ana',
      lastName: 'Pérez',
      roleCode: 'CONTADOR',
    });
    expect(constraintMessages(dto)).toEqual([
      'password no puede superar 72 bytes',
    ]);
  });
});
