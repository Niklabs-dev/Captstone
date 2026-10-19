// Nombre original para mostrar y descargar: sin carpetas ni caracteres de
// control, y dentro del largo de la columna file_name. El archivo físico usa
// otro nombre, aleatorio (StorageService). Lo comparten la carga de
// documentos laborales (SPRINT-2-T05) y de liquidaciones (SPRINT-2-T13).
export function sanitizeFileName(originalName: string): string {
  const baseName = originalName.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = baseName.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return Array.from(clean).slice(0, 255).join('') || 'documento';
}
