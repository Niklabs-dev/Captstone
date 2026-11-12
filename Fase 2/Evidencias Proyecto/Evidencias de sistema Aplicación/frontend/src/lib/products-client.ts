import { isRecord } from './auth';
import {
  parseFieldErrors,
  parseProduct,
  parseProducts,
  parseSections,
  productErrorMessage,
  type Product,
  type ProductFieldErrors,
  type ProductInput,
  type ProductSection,
} from './products';

// Cliente del BFF de productos de inventario (SPRINT-5-T04).
export class ProductRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly fieldErrors: ProductFieldErrors | null = null,
  ) {
    super(productErrorMessage(status));
    this.name = 'ProductRequestError';
  }
}

async function request<T>(
  path: string,
  init: RequestInit,
  parse: (value: unknown) => T | null,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api/products' + path, {
      ...init,
      cache: 'no-store',
      credentials: 'same-origin',
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError')
      throw cause;
    throw new ProductRequestError(503);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new ProductRequestError(
      response.status,
      isRecord(body) ? parseFieldErrors(body) : null,
    );
  const parsed = parse(body);
  if (parsed === null) throw new ProductRequestError(502);
  return parsed;
}

export function loadProducts(signal: AbortSignal): Promise<Product[]> {
  return request('', { signal }, parseProducts);
}
export function loadSections(signal: AbortSignal): Promise<ProductSection[]> {
  return request('/sections', { signal }, parseSections);
}
export function saveProduct(
  input: ProductInput,
  id: string | null,
): Promise<Product> {
  return request(
    id ? '/' + id : '',
    {
      method: id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    parseProduct,
  );
}
export function setProductActive(
  id: string,
  isActive: boolean,
): Promise<Product> {
  return request(
    `/${id}/${isActive ? 'reactivate' : 'deactivate'}`,
    { method: 'PATCH' },
    parseProduct,
  );
}
