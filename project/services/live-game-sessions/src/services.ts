export type ServiceReply = { ok: boolean; status: number; body: any }

export async function callService(
  method: string,
  url: string,
  authorization: string,
  timeoutMs: number,
  body?: unknown,
): Promise<ServiceReply | null> {
  try {
    const res = await fetch(url, {
      method,
      headers: { authorization, accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await res.text()
    let parsed = null
    try {
      parsed = JSON.parse(text)
    } catch {}
    return { ok: res.ok, status: res.status, body: parsed }
  } catch {
    return null
  }
}
