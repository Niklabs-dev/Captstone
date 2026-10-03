// Convierte duraciones cortas tipo "30m", "12h" o "7d" a milisegundos.
// Se usa para calcular la expiración de los refresh tokens en la BD a partir
// de JWT_REFRESH_EXPIRES_IN (mismo formato que acepta jsonwebtoken).
const UNIT_TO_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseDurationToMs(value: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(value.trim());
  if (!match) {
    throw new Error(
      `Duración inválida: "${value}". Usa formatos como 300s, 30m, 12h o 7d.`,
    );
  }
  return Number(match[1]) * UNIT_TO_MS[match[2]];
}
