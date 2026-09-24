export type Role = 'administrador' | 'contador' | 'supervisor' | 'trabajador';

export interface SessionUser {
  id: string;
  nombre: string;
  rol: Role;
  local?: string; // ej. LOC-01, LOC-02, LOC-03 — vacío para roles con alcance de los 3 locales
}
