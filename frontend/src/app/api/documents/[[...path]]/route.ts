import { getUsersSession } from '@/lib/users-session';
import { hasTrustedOrigin } from '@/lib/auth';
import { isDocumentType, MAX_DOCUMENT_BYTES } from '@/lib/documents';
import {
  isProxyUuid,
  proxyBackend,
  proxyError,
  readProxyForm,
} from '@/lib/backend-proxy';

type Context = { params: Promise<{ path?: string[] }> };
export async function GET(
  request: Request,
  context: Context,
): Promise<Response> {
  const session = await getUsersSession();
  if (!session.ok) return proxyError(session.status);
  const { path = [] } = await context.params;
  const query = new URL(request.url).searchParams;
  if (!path.length) {
    const workerId = query.get('workerId');
    if (
      !workerId ||
      !isProxyUuid(workerId) ||
      query.getAll('workerId').length !== 1 ||
      [...query.keys()].some((key) => key !== 'workerId')
    )
      return proxyError(400);
    return proxyBackend(
      '/documents?workerId=' + encodeURIComponent(workerId),
      session.token,
    );
  }
  if ([...query.keys()].length) return proxyError(400);
  if (path.length === 2 && isProxyUuid(path[0]) && path[1] === 'versions')
    return proxyBackend(`/documents/${path[0]}/versions`, session.token);
  if (
    path.length === 3 &&
    path[0] === 'versions' &&
    isProxyUuid(path[1]) &&
    ['integrity', 'download'].includes(path[2])
  )
    return proxyBackend(
      `/documents/versions/${path[1]}/${path[2]}`,
      session.token,
      {},
      path[2] === 'download',
    );
  return proxyError(404);
}
export async function POST(
  request: Request,
  context: Context,
): Promise<Response> {
  if (!hasTrustedOrigin(request)) return proxyError(403);
  const session = await getUsersSession();
  if (!session.ok) return proxyError(session.status);
  const { path = [] } = await context.params;
  if (path.length) return proxyError(404);
  const form = await readProxyForm(request, MAX_DOCUMENT_BYTES);
  if (!form) return proxyError(400);
  const file = form.get('file'),
    workerId = form.get('workerId'),
    type = form.get('documentTypeCode'),
    documentId = form.get('documentId');
  if (
    !(file instanceof File) ||
    !file.size ||
    typeof workerId !== 'string' ||
    !isProxyUuid(workerId) ||
    !isDocumentType(type) ||
    (documentId !== null &&
      (typeof documentId !== 'string' || !isProxyUuid(documentId)))
  )
    return proxyError(400);
  if (file.size > MAX_DOCUMENT_BYTES) return proxyError(413);
  const payload = new FormData();
  payload.set('file', file);
  payload.set('workerId', workerId);
  payload.set('documentTypeCode', type);
  for (const key of ['title', 'documentId', 'issuedAt', 'changeNote']) {
    const value = form.get(key);
    if (typeof value === 'string') payload.set(key, value);
  }
  return proxyBackend('/documents', session.token, {
    method: 'POST',
    body: payload,
  });
}
