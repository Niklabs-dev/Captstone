import { callBackend } from './auth-backend';

export function proxyError(status: number): Response {
  const messages: Record<number, string> = {
    400: 'La solicitud no es válida. Revisa los datos ingresados.',
    401: 'Tu sesión venció. Vuelve a iniciar sesión.',
    403: 'No tienes permiso para realizar esta operación.',
    404: 'El recurso no está disponible.',
    409: 'Los datos cambiaron o ya existen. Actualiza el listado antes de continuar.',
    413: 'El archivo supera el tamaño permitido.',
    415: 'El formato del archivo no está permitido.',
    429: 'Demasiadas solicitudes. Espera unos momentos e intenta nuevamente.',
    502: 'No se pudo verificar la respuesta del servicio. Intenta nuevamente.',
    503: 'No se pudo conectar con el servicio. Intenta nuevamente más tarde.',
  };
  return Response.json(
    { message: messages[status] ?? messages[502] },
    { status, headers: { 'Cache-Control': 'private, no-store' } },
  );
}

// Solo recibe rutas construidas por los handlers; nunca una URL del navegador.
export async function proxyBackend(
  path: string,
  token: string,
  init: RequestInit = {},
  download = false,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const upstream = await callBackend(path, {
    ...init,
    headers,
    redirect: 'error',
  });
  if (!upstream) return proxyError(503);
  if (!upstream.ok) {
    await upstream.body?.cancel();
    return proxyError(
      [400, 401, 403, 404, 409, 413, 415, 429].includes(upstream.status)
        ? upstream.status
        : 502,
    );
  }
  if (download) {
    const forwarded = new Headers({ 'X-Content-Type-Options': 'nosniff' });
    for (const name of [
      'Content-Type',
      'Content-Length',
      'Content-Disposition',
      'X-Document-Integrity',
    ]) {
      const value = upstream.headers.get(name);
      if (value) forwarded.set(name, value);
    }
    forwarded.set('Cache-Control', 'private, no-store');
    return new Response(upstream.body, {
      status: upstream.status,
      headers: forwarded,
    });
  }
  const data: unknown = await upstream.json().catch(() => null);
  if (data === null) return proxyError(502);
  return Response.json(data, {
    status: upstream.status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

export function isProxyUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

// Acota el cuerpo antes de interpretar multipart, también sin Content-Length.
export async function readProxyForm(
  request: Request,
  maxBytes: number,
): Promise<FormData | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: BlobPart[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes + 1024 * 1024) {
        await reader.cancel();
        return null;
      }
      chunks.push(new Uint8Array(value));
    }
    return await new Response(new Blob(chunks), {
      headers: { 'Content-Type': request.headers.get('Content-Type') ?? '' },
    }).formData();
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}
