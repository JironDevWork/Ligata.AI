const base = '/umbraco/management/api/v1/ligata-ai';
export const managementBase = base;

export async function bearer(auth) {
  const config = auth.getOpenApiConfiguration();
  const token = typeof config.token === 'function' ? await config.token() : await config.token;
  return { Authorization: `Bearer ${token}` };
}

export async function aiRequest(auth, path = '', method = 'GET', body, { timeout = 30000 } = {}) {
  const isForm = body instanceof FormData;
  const response = await fetch(base + path, {
    method, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(timeout),
    headers: { ...(await bearer(auth)), ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.message || data?.error?.message || (response.status === 403 ? 'Your user group cannot manage the AI assistant. Ask an administrator to add it to LigataAI:EditorGroups.' : `Request failed (${response.status}).`));
    error.errors = data?.errors || {};
    error.status = response.status;
    throw error;
  }
  return data;
}
