export interface UsuarioRow {
  id: string;
  nombre: string;
  correo: string;
  rol: 'Administrador' | 'Contador' | 'Supervisor' | 'Trabajador';
  alcance: string;
  estado: 'Activo' | 'Desactivado';
}

export const MOCK_USUARIOS: UsuarioRow[] = [
  { id: 'u1', nombre: 'Moisés Jiménez', correo: 'admin@moifood.cl', rol: 'Administrador', alcance: 'Consolidado 3 locales', estado: 'Activo' },
  { id: 'u2', nombre: 'Ricardo Ballesteros', correo: 'contador@moifood.cl', rol: 'Contador', alcance: '3 locales · reportes', estado: 'Activo' },
  { id: 'u3', nombre: 'Rosa Fernández', correo: 'rosa@moifood.cl', rol: 'Supervisor', alcance: 'Solo LOC-01', estado: 'Activo' },
  { id: 'u4', nombre: 'Grace Muñoz', correo: 'grace@moifood.cl', rol: 'Supervisor', alcance: 'Solo LOC-02', estado: 'Activo' },
  { id: 'u5', nombre: 'Lisbely Araya', correo: 'lisbely@moifood.cl', rol: 'Supervisor', alcance: 'Solo LOC-03 (Calera)', estado: 'Activo' },
  { id: 'u6', nombre: 'Camila Rojas', correo: 'trabajador@moifood.cl', rol: 'Trabajador', alcance: 'Solo su información', estado: 'Activo' },
  { id: 'u7', nombre: 'Andrés Molina', correo: 'andres@moifood.cl', rol: 'Trabajador', alcance: '—', estado: 'Desactivado' },
];

export interface AuditoriaRow {
  hora: string;
  usuario: string;
  accion: string;
  modulo: 'Propinas' | 'Documental' | 'Inventario' | 'Ventas' | 'Portal' | 'Núcleo';
  hash: string;
}

export const MOCK_AUDITORIA: AuditoriaRow[] = [
  { hora: '09:42', usuario: 'M. Jiménez', accion: 'aprobó el reparto de propinas semana 35', modulo: 'Propinas', hash: '#a91f' },
  { hora: '09:15', usuario: 'Contador', accion: 'publicó 13 liquidaciones de agosto', modulo: 'Documental', hash: '#a91e' },
  { hora: '08:57', usuario: 'G. Muñoz', accion: 'registró merma: pan italiano 26 un', modulo: 'Inventario', hash: '#a91d' },
  { hora: '22:37', usuario: 'G. Muñoz', accion: 'cerró caja LOC-02 con diferencia −$4.250', modulo: 'Ventas', hash: '#a91c' },
  { hora: '21:04', usuario: 'C. Rojas', accion: 'descargó su liquidación de agosto', modulo: 'Portal', hash: '#a91b' },
  { hora: '18:33', usuario: 'Sistema', accion: 'bloqueó eliminación de documento (conservación 5 años)', modulo: 'Núcleo', hash: '#a91a' },
  { hora: '17:12', usuario: 'R. Fernández', accion: 'subió turnos de septiembre LOC-01', modulo: 'Documental', hash: '#a919' },
];
