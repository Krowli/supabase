import { createHmac } from 'node:crypto'

/**
 * A signed HS256 token for a service's own admin API.
 *
 * Supavisor and Realtime both accept a bearer token signed with their `API_JWT_SECRET`, which in
 * this stack is the same string Studio holds as `AUTH_JWT_SECRET`. Written here rather than pulled
 * from a library because the whole of it is three base64url segments and an HMAC, and a dependency
 * that signs tokens is a dependency that can also verify them — something no code here should do.
 *
 * The token is short-lived on purpose: it is minted for one request and never stored, so a default
 * of five minutes is generous and nothing here needs a refresh path.
 */
const base64url = (value: string): string => Buffer.from(value, 'utf8').toString('base64url')

export function signHs256Jwt(
  payload: Record<string, unknown>,
  secret: string,
  ttlSeconds = 300
): string {
  const issuedAt = Math.floor(Date.now() / 1000)

  // `exp` is not optional: Supavisor's `Supavisor.Jwt` validates it against the current time, and a
  // token without one is rejected. `iat` is not checked by anything here — it is written because a
  // token that cannot say when it was minted is harder to reason about in a log.
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const claims = base64url(
    JSON.stringify({ ...payload, iat: issuedAt, exp: issuedAt + ttlSeconds })
  )

  const signingInput = `${header}.${claims}`
  const signature = createHmac('sha256', secret).update(signingInput).digest('base64url')

  return `${signingInput}.${signature}`
}
