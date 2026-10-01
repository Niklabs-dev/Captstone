// Tipos del módulo de usuarios (SPRINT-1-T08).

export interface UserRoleSummary {
  code: string;
  name: string;
}

export interface UserStoreSummary {
  id: string;
  name: string;
}

// Vista pública de un usuario: sin hash de contraseña.
export interface UserResponse {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  rut: string | null;
  phone: string | null;
  // Fecha de negocio en formato YYYY-MM-DD.
  hiredAt: string | null;
  isActive: boolean;
  role: UserRoleSummary;
  store: UserStoreSummary | null;
  createdAt: Date;
}
