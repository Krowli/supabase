import { COMPUTED_KEYS } from './defaults'
import { PLATFORM_CONFIG_TYPES } from './keys.generated'
import { MANAGED_KEYS, PlatformConfig } from './mapping'

export type ValidationResult = { ok: true } | { ok: false; message: string }

const ok: ValidationResult = { ok: true }
const fail = (message: string): ValidationResult => ({ ok: false, message })

/** Keys the UI derives from the rest of the config. A PATCH that names one is a client bug. */
const READ_ONLY_KEYS: ReadonlySet<string> = new Set<string>(COMPUTED_KEYS)

/** Hours. GoTrue holds both as a duration; a year is already far past any useful session limit. */
const MAX_SESSION_HOURS = 8760

/** Seconds. GoTrue's own cap on how long a used refresh token stays replayable. */
const MAX_REUSE_INTERVAL_SECONDS = 300

/**
 * Characters a redirect URL may use. The unreserved and reserved sets of RFC 3986 plus `%`, and the
 * glob metacharacters `[]{}` — `URI_ALLOW_LIST` entries are globs, compiled by GoTrue with
 * `glob.MustCompile`, and `*` and `?` are already reserved characters.
 */
const ALLOWED_URI_CHARACTERS = /^[A-Za-z0-9\-._~:/?#@!$&'()*+,;=%[\]{}]+$/

/** A Postgres identifier: what `pg-functions://` hook URIs name a schema and a function with. */
const POSTGRES_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/

const PG_FUNCTIONS_SCHEME = 'pg-functions://'
const PG_FUNCTIONS_URI = /^pg-functions:\/\/postgres\/([^/]+)\/([^/]+)$/

/** Hosts an unencrypted hook may point at: a hook URI over plain HTTP must not leave the machine. */
const PLAIN_HTTP_HOSTS: ReadonlySet<string> = new Set([
  '::1',
  '127.0.0.1',
  'host.docker.internal',
  'localhost',
])

/** GoTrue's two webhook secret formats: a symmetric `whsec_`, or an asymmetric `whpk_`/`whsk_` pair. */
const SYMMETRIC_SECRET = /^v1,whsec_[A-Za-z0-9+/=]+$/
const ASYMMETRIC_SECRET = /^v1a,whpk_[^:]+:whsk_.+$/

const isBlank = (value: unknown) => typeof value !== 'string' || value.trim() === ''

/**
 * Whether a value matches the type the platform contract declares for its key.
 *
 * Driven off the generated table rather than a list of keys written here, because a list written
 * here covers only the keys someone thought of. Every value that passes goes into a file GoTrue
 * reloads as a whole, so a string where a number belongs does not break one setting — it leaves
 * every setting in the file unapplied.
 */
function validateDeclaredType(key: string, value: unknown): ValidationResult {
  const declared = PLATFORM_CONFIG_TYPES[key]

  if (Array.isArray(declared)) {
    if (typeof value !== 'string' || !declared.includes(value))
      return fail(`${key} must be one of: ${declared.map((allowed) => `'${allowed}'`).join(', ')}`)
    return ok
  }

  // Only the two `*_CUSTOM_CONTENTS` keys, already refused as read-only before this runs.
  if (declared === 'object') return fail(`${key} is read-only`)

  if (typeof value !== declared) return fail(`${key} must be a ${declared}`)

  return ok
}

/** Balanced, properly nested `[]` and `{}`. An unbalanced glob panics GoTrue on startup. */
function hasBalancedBrackets(entry: string): boolean {
  const closers: string[] = []

  for (const character of entry) {
    if (character === '[') closers.push(']')
    else if (character === '{') closers.push('}')
    else if (character === ']' || character === '}') {
      if (closers.pop() !== character) return false
    }
  }

  return closers.length === 0
}

function validateUriAllowList(value: unknown): ValidationResult {
  if (typeof value !== 'string') return fail('URI_ALLOW_LIST must be a comma-separated string')
  // An empty list is how every extra redirect URL is removed.
  if (value === '') return ok

  for (const entry of value.split(',').map((part) => part.trim())) {
    if (entry === '') return fail('URI_ALLOW_LIST has an empty entry')
    if (/\s/.test(entry)) return fail(`URI_ALLOW_LIST entry contains whitespace: ${entry}`)
    if (!ALLOWED_URI_CHARACTERS.test(entry))
      return fail(`URI_ALLOW_LIST entry has an unsupported character: ${entry}`)
    if (!hasBalancedBrackets(entry))
      return fail(`URI_ALLOW_LIST entry has unbalanced brackets: ${entry}`)
  }

  return ok
}

function validateHookUri(key: string, value: unknown): ValidationResult {
  if (typeof value !== 'string') return fail(`${key} must be a string`)
  // An empty URI is how a hook is removed.
  if (value === '') return ok

  if (value.startsWith(PG_FUNCTIONS_SCHEME)) {
    const postgres = PG_FUNCTIONS_URI.exec(value)
    if (postgres === null) {
      // GoTrue reaches a Postgres hook over its own connection, so the host is not an address it
      // dials — it is fixed. A different one is a misreading of the format, not another database.
      const host = value.slice(PG_FUNCTIONS_SCHEME.length).split('/')[0]
      if (host !== 'postgres')
        return fail(`${key} must use the host 'postgres', not '${host}': ${value}`)

      return fail(`${key} must be ${PG_FUNCTIONS_SCHEME}postgres/<schema>/<function>: ${value}`)
    }

    const [, schema, name] = postgres
    if (!POSTGRES_IDENTIFIER.test(schema) || !POSTGRES_IDENTIFIER.test(name))
      return fail(`${key} names an invalid Postgres schema or function: ${value}`)

    return ok
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return fail(`${key} must be a pg-functions:// or https:// URI`)
  }

  if (url.protocol === 'https:') return ok

  if (url.protocol === 'http:') {
    const host = url.hostname.replace(/^\[|\]$/g, '')
    if (PLAIN_HTTP_HOSTS.has(host)) return ok
    return fail(`${key} may only use http:// for a local host, not ${url.hostname}`)
  }

  return fail(`${key} must be a pg-functions:// or https:// URI`)
}

function validateHookSecrets(key: string, value: unknown): ValidationResult {
  if (typeof value !== 'string') return fail(`${key} must be a string`)
  // No secrets is how signing is turned off.
  if (value === '') return ok

  for (const secret of value.split('|')) {
    if (!SYMMETRIC_SECRET.test(secret) && !ASYMMETRIC_SECRET.test(secret))
      return fail(`${key} contains a secret that is not in the v1,whsec_ or v1a,whpk_ format`)
  }

  return ok
}

function validateValue(key: string, value: unknown): ValidationResult {
  if (key === 'SITE_URL') {
    if (typeof value !== 'string') return fail('SITE_URL must be a string')
    try {
      new URL(value)
    } catch {
      return fail(`SITE_URL must be a valid URL: ${value}`)
    }
    return ok
  }

  if (key === 'URI_ALLOW_LIST') return validateUriAllowList(value)

  if (key.startsWith('HOOK_') && key.endsWith('_URI')) return validateHookUri(key, value)
  if (key.startsWith('HOOK_') && key.endsWith('_SECRETS')) return validateHookSecrets(key, value)

  if (key === 'SESSIONS_TIMEBOX' || key === 'SESSIONS_INACTIVITY_TIMEOUT') {
    if (typeof value !== 'number' || !Number.isFinite(value))
      return fail(`${key} must be a number of hours`)
    if (value < 0 || value > MAX_SESSION_HOURS)
      return fail(`${key} must be between 0 and ${MAX_SESSION_HOURS} hours`)
    return ok
  }

  if (key === 'SECURITY_REFRESH_TOKEN_REUSE_INTERVAL') {
    if (typeof value !== 'number' || !Number.isInteger(value))
      return fail(`${key} must be a whole number of seconds`)
    if (value < 0 || value > MAX_REUSE_INTERVAL_SECONDS)
      return fail(`${key} must be between 0 and ${MAX_REUSE_INTERVAL_SECONDS} seconds`)
    return ok
  }

  if (key === 'SMTP_PORT') {
    // An empty port is how it is cleared. `toEnv` drops it rather than writing `""`, which
    // GoTrue's `int` field cannot parse.
    if (value === '') return ok
    if (typeof value !== 'string' || !/^\d+$/.test(value))
      return fail('SMTP_PORT must be a string of digits')
    const port = Number(value)
    if (port < 1 || port > 65535) return fail('SMTP_PORT must be between 1 and 65535')
    return ok
  }

  return ok
}

/**
 * Cross-field rules, checked against the config as it would be after the patch.
 *
 * Each runs only when the patch touches one of the keys it names. A rule that ran on every patch
 * would let one bad stored value block every later save — including saves that have nothing to do
 * with it — and the save that would repair it touches one of these keys anyway, so nothing escapes.
 */
function validateCombinations(
  patch: Record<string, unknown>,
  merged: Record<string, unknown>
): ValidationResult {
  const touches = (...keys: string[]) => keys.some((key) => key in patch)

  if (
    touches('SECURITY_CAPTCHA_ENABLED', 'SECURITY_CAPTCHA_SECRET', 'SECURITY_CAPTCHA_PROVIDER') &&
    merged.SECURITY_CAPTCHA_ENABLED === true
  ) {
    if (isBlank(merged.SECURITY_CAPTCHA_SECRET))
      return fail('SECURITY_CAPTCHA_SECRET is required when captcha is enabled')
    if (
      merged.SECURITY_CAPTCHA_PROVIDER !== 'hcaptcha' &&
      merged.SECURITY_CAPTCHA_PROVIDER !== 'turnstile'
    )
      return fail("SECURITY_CAPTCHA_PROVIDER must be 'hcaptcha' or 'turnstile'")
  }

  if (
    touches('PASSKEY_ENABLED', 'WEBAUTHN_RP_ID', 'WEBAUTHN_RP_DISPLAY_NAME') &&
    merged.PASSKEY_ENABLED === true
  ) {
    if (isBlank(merged.WEBAUTHN_RP_ID))
      return fail('WEBAUTHN_RP_ID is required when passkeys are enabled')
    if (isBlank(merged.WEBAUTHN_RP_DISPLAY_NAME))
      return fail('WEBAUTHN_RP_DISPLAY_NAME is required when passkeys are enabled')
  }

  return ok
}

/**
 * Whether a PATCH body may be written. `current` is the config as it stands, used only by the rules
 * that need more than one key to decide.
 *
 * Every value here ends up in a file GoTrue reloads as a whole, so a value it cannot parse does not
 * break one setting — it leaves every setting in the file unapplied. This is the gate that keeps
 * that from happening.
 */
export function validatePatch(
  patch: Record<string, unknown>,
  current: PlatformConfig
): ValidationResult {
  for (const [key, value] of Object.entries(patch)) {
    if (READ_ONLY_KEYS.has(key)) return fail(`${key} is read-only`)
    if (!MANAGED_KEYS.has(key)) return fail(`Unknown auth config key: ${key}`)

    // Null clears a key; the type and value rules below have nothing to say about it.
    if (value === null) continue

    const declared = validateDeclaredType(key, value)
    if (!declared.ok) return declared

    const result = validateValue(key, value)
    if (!result.ok) return result
  }

  return validateCombinations(patch, { ...current, ...patch } as Record<string, unknown>)
}
