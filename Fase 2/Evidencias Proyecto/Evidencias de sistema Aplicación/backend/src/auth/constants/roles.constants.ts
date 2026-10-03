// Códigos de rol del sistema (SPRINT-1-T07). Deben coincidir con los roles
// base que siembra prisma/seed.ts (BASE_ROLES).
export const ROLE = {
  ADMINISTRADOR: 'ADMINISTRADOR',
  SUPERVISOR: 'SUPERVISOR',
  TRABAJADOR: 'TRABAJADOR',
  CONTADOR: 'CONTADOR',
} as const;

export type RoleCode = (typeof ROLE)[keyof typeof ROLE];

// Roles globales: no están atados a un local y acceden a todos ellos.
export const GLOBAL_ROLES: readonly RoleCode[] = [
  ROLE.ADMINISTRADOR,
  ROLE.CONTADOR,
];
