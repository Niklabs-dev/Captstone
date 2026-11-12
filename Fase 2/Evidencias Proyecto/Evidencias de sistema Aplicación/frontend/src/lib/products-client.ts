import { isRecord } from './auth';
import {
  parseFieldErrors,
  parseProduct,
  parseProducts,
  parseSections,
  parseSuggestion,
  parseTemplateRows,
  productErrorMessage,
  type PlacementSuggestion,
  type Product,
  type ProductFieldErrors,
  type ProductInput,
  type ProductSection,
  type ProductUpdate,
  type TemplateRow,
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
const json = (method: 'POST' | 'PATCH', body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export function loadProducts(signal: AbortSignal): Promise<Product[]> {
  return request('', { signal }, parseProducts);
}
export function loadSections(signal: AbortSignal): Promise<ProductSection[]> {
  return request('/sections', { signal }, parseSections);
}
export function loadTemplate(signal: AbortSignal): Promise<TemplateRow[]> {
  return request('/template', { signal }, parseTemplateRows);
}
export function loadSuggestion(
  query: { section: string; name: string; alternativeNames: string[] },
  signal: AbortSignal,
): Promise<PlacementSuggestion> {
  const params = new URLSearchParams({
    section: query.section,
    name: query.name,
  });
  for (const name of query.alternativeNames)
    params.append('alternativeNames', name);
  return request(
    '/template/suggestion?' + params.toString(),
    { signal },
    parseSuggestion,
  );
}
export function createProduct(input: ProductInput): Promise<Product> {
  return request('', json('POST', input), parseProduct);
}
export function updateProduct(
  id: string,
  input: ProductUpdate,
): Promise<Product> {
  return request('/' + id, json('PATCH', input), parseProduct);
}
export function moveProduct(
  id: string,
  templateRowId: string,
): Promise<Product> {
  return request(`/${id}/move`, json('PATCH', { templateRowId }), parseProduct);
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
