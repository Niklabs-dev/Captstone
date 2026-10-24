export function normalizeStoreText(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

export function normalizeStoreName(value: string): string {
  return normalizeStoreText(value).toUpperCase();
}
