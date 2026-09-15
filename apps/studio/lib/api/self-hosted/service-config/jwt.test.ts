import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { signHs256Jwt } from './jwt'

const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long'

const decode = (segment: string): unknown =>
  JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))

const parts = (token: string) => {
  const [header, claims, signature] = token.split('.')
  return { header, claims, signature }
}

describe('api/self-hosted/service-config/jwt', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('signs a token the secret holder can verify', () => {
    const token = signHs256Jwt({ role: 'service_role' }, SECRET)
    const { header, claims, signature } = parts(token)

    // Verified the way the service does: re-sign the signing input and compare, rather than
    // trusting a library to agree with itself.
    const expected = createHmac('sha256', SECRET).update(`${header}.${claims}`).digest('base64url')

    expect(signature).toBe(expected)
  })

  it('does not verify under a different secret', () => {
    const token = signHs256Jwt({}, SECRET)
    const { header, claims, signature } = parts(token)

    const other = createHmac('sha256', 'a-different-secret')
      .update(`${header}.${claims}`)
      .digest('base64url')

    expect(signature).not.toBe(other)
  })

  it('declares HS256 in the header', () => {
    expect(decode(parts(signHs256Jwt({}, SECRET)).header)).toEqual({ alg: 'HS256', typ: 'JWT' })
  })

  it('carries the payload alongside iat and a future exp', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    const issuedAt = Math.floor(Date.parse('2026-01-01T00:00:00.000Z') / 1000)

    const claims = decode(parts(signHs256Jwt({ role: 'service_role' }, SECRET)).claims)

    expect(claims).toEqual({ role: 'service_role', iat: issuedAt, exp: issuedAt + 300 })
  })

  it('honours a ttl the caller asks for', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    const issuedAt = Math.floor(Date.parse('2026-01-01T00:00:00.000Z') / 1000)

    const claims = decode(parts(signHs256Jwt({}, SECRET, 60)).claims)

    expect(claims).toEqual({ iat: issuedAt, exp: issuedAt + 60 })
  })

  it('emits base64url, so a token survives a header and a URL unchanged', () => {
    // A payload whose JSON base64-encodes with both `+` and `/` in the standard alphabet.
    const token = signHs256Jwt({ sub: '<<???>>~ÿÿ' }, SECRET)

    expect(token).not.toMatch(/[+/=]/)
    expect(token.split('.')).toHaveLength(3)
  })
})
