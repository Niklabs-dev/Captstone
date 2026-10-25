import { BadRequestException } from '@nestjs/common';
import { ROLE } from '../../auth/constants/roles.constants.js';
import { resolveFinalStoreId } from './user-assignment.util.js';

const STORE_A = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const STORE_B = '1c6f6f2e-8d1a-4f0b-9a3e-5b2c7d8e9f01';

describe('Cálculo del local final al editar un usuario (SPRINT-3-T03)', () => {
  it('usa el local enviado en la solicitud', () => {
    expect(resolveFinalStoreId(ROLE.TRABAJADOR, STORE_A, STORE_B)).toBe(
      STORE_B,
    );
  });

  it('conserva el local actual si el rol de local no cambia de local', () => {
    expect(resolveFinalStoreId(ROLE.SUPERVISOR, STORE_A, undefined)).toBe(
      STORE_A,
    );
  });

  it('deja el local en null al pasar a un rol global sin enviar storeId', () => {
    expect(resolveFinalStoreId(ROLE.CONTADOR, STORE_A, undefined)).toBeNull();
    expect(resolveFinalStoreId(ROLE.ADMINISTRADOR, null, undefined)).toBeNull();
  });

  it('rechaza un rol global con local asignado', () => {
    expect(() => resolveFinalStoreId(ROLE.CONTADOR, null, STORE_A)).toThrow(
      BadRequestException,
    );
  });

  it('rechaza un rol de local sin local (storeId null explícito)', () => {
    expect(() => resolveFinalStoreId(ROLE.TRABAJADOR, STORE_A, null)).toThrow(
      'El rol TRABAJADOR requiere un local asignado',
    );
  });

  it('rechaza pasar de un rol global a uno de local sin enviar storeId', () => {
    expect(() => resolveFinalStoreId(ROLE.SUPERVISOR, null, undefined)).toThrow(
      'El rol SUPERVISOR requiere un local asignado',
    );
  });
});
