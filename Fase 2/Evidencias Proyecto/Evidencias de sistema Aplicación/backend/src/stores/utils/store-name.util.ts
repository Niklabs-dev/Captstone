export function normalizeStoreText(value: string): string {
  return value
    .replace(/\p{Cf}/gu, '')
    .trim()
    .replace(/\s+/gu, ' ');
}

export function normalizeStoreName(value: string): string {
  return normalizeStoreText(value)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase();
}
