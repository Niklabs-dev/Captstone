import { ROLE } from '../../auth/constants/roles.constants.js';
import type { AuthUser } from '../../auth/types/auth.types.js';
import {
  canReadDocument,
  canReadOthersDocuments,
} from './document-access.policy.js';

const STORE_A = 'store-a';
const STORE_B = 'store-b';

function user(id: string, role: string, storeId: string | null): AuthUser {
  return { id, email: `${id}@moi-food.cl`, role, storeId };
}

describe('canReadDocument (SPRINT-2-T06)', () => {
  const document = { storeId: STORE_A, subjectUserId: 'worker-1' };

  it('el titular ve sus documentos, incluso si cambió de local', () => {
    expect(
      canReadDocument(user('worker-1', ROLE.TRABAJADOR, STORE_A), document),
    ).toBe(true);
    expect(
      canReadDocument(user('worker-1', ROLE.TRABAJADOR, STORE_B), document),
    ).toBe(true);
  });

  it('el administrador ve los documentos de cualquier local', () => {
    expect(
      canReadDocument(user('admin', ROLE.ADMINISTRADOR, null), document),
    ).toBe(true);
  });

  it('nadie más ve documentos ajenos, aunque sea del mismo local', () => {
    expect(
      canReadDocument(user('worker-2', ROLE.TRABAJADOR, STORE_A), document),
    ).toBe(false);
    expect(
      canReadDocument(user('super', ROLE.SUPERVISOR, STORE_A), document),
    ).toBe(false);
    expect(canReadDocument(user('conta', ROLE.CONTADOR, null), document)).toBe(
      false,
    );
  });

  it('un documento sin titular (del local) solo lo ve el administrador', () => {
    const storeDocument = { storeId: STORE_A, subjectUserId: null };
    expect(
      canReadDocument(user('admin', ROLE.ADMINISTRADOR, null), storeDocument),
    ).toBe(true);
    expect(
      canReadDocument(user('super', ROLE.SUPERVISOR, STORE_A), storeDocument),
    ).toBe(false);
  });

  it('solo el administrador consulta documentos de otros trabajadores', () => {
    expect(canReadOthersDocuments(user('a', ROLE.ADMINISTRADOR, null))).toBe(
      true,
    );
    expect(canReadOthersDocuments(user('s', ROLE.SUPERVISOR, STORE_A))).toBe(
      false,
    );
  });
});
