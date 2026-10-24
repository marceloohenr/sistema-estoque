export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    cache: 'no-store',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })

  if (response.status === 204) return null

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.error?.message ?? 'Não foi possível concluir a operação.')
    error.status = response.status
    error.code = payload.error?.code
    throw error
  }
  return payload
}

export const json = (method, body) => ({ method, body: JSON.stringify(body) })
