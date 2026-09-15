import { components } from 'api-types'

import { COMPUTED_KEYS, DEFAULTS, NULL_BY_DEFAULT, TEMPLATE_IDS } from './defaults'
import { PLATFORM_CONFIG_TYPES } from './keys.generated'
import { MANAGED_KEYS, toEnv } from './mapping'
import { getConfigDir, renderEnvFile, writeEnvFile } from './render'
import { AuthConfigState, readState, writeState } from './state'
import { validatePatch } from './validate'

type GoTrueConfigResponse = components['schemas']['GoTrueConfigResponse']

// Re-exported because a route carrying a template id in its path has to check the string it was
// given against the 13 real ones, and a type cannot do that at runtime.
export { TEMPLATE_IDS } from './defaults'

/** One of the 13 email templates the Auth UI edits. */
export type TemplateId = (typeof TEMPLATE_IDS)[number]

/** A PATCH the running GoTrue would refuse or misread. The route answers it with a 400. */
export class AuthConfigValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthConfigValidationError'
  }
}

/**
 * The GoTrue settings the self-hosted stack mirrors into Studio's own container env.
 *
 * They are what a GET answers with before anything has been saved from the UI: the values GoTrue
 * was actually started with, rather than the defaults it would have used without them.
 *
 * Spelled out one name at a time because `turbo.jsonc` has to declare every env name the build
 * reads, and a name assembled at runtime declares nothing. Every entry here is `GOTRUE_` plus a
 * platform key — keys whose GoTrue name is spelled differently, and the email templates, which
 * GoTrue holds as a URL rather than a body, are deliberately not mirrored.
 */
export const MIRRORED_ENV_KEYS = [
  'GOTRUE_DISABLE_SIGNUP',
  'GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED',
  'GOTRUE_EXTERNAL_EMAIL_ENABLED',
  'GOTRUE_EXTERNAL_PHONE_ENABLED',
  'GOTRUE_JWT_EXP',
  'GOTRUE_MAILER_AUTOCONFIRM',
  'GOTRUE_MAILER_SUBJECTS_CONFIRMATION',
  'GOTRUE_MAILER_SUBJECTS_EMAIL_CHANGE',
  'GOTRUE_MAILER_SUBJECTS_INVITE',
  'GOTRUE_MAILER_SUBJECTS_MAGIC_LINK',
  'GOTRUE_MAILER_SUBJECTS_RECOVERY',
  'GOTRUE_SITE_URL',
  'GOTRUE_SMS_AUTOCONFIRM',
  'GOTRUE_SMTP_ADMIN_EMAIL',
  'GOTRUE_SMTP_HOST',
  'GOTRUE_SMTP_PASS',
  'GOTRUE_SMTP_PORT',
  'GOTRUE_SMTP_SENDER_NAME',
  'GOTRUE_SMTP_USER',
  'GOTRUE_URI_ALLOW_LIST',
] as const

const ENV_PREFIX = 'GOTRUE_'

/** `{ platformKey → env name }`, so the resolution below looks a key up rather than building one. */
const MIRRORED_BY_KEY: ReadonlyMap<string, string> = new Map(
  MIRRORED_ENV_KEYS.map((name) => [name.slice(ENV_PREFIX.length), name])
)

/**
 * Every key a GET answers for, minus the two Studio computes. `DEFAULTS` and `NULL_BY_DEFAULT`
 * together are exactly the properties of `GoTrueConfigResponse` — `defaults.test.ts` checks that
 * against the generated type — and `MANAGED_KEYS` drops the computed pair.
 */
const RESOLVED_KEYS: readonly string[] = [
  ...Object.keys(DEFAULTS),
  ...(NULL_BY_DEFAULT as readonly string[]),
].filter((key) => MANAGED_KEYS.has(key))

/** What Go's `strconv.ParseBool` accepts, which is what GoTrue read the mirrored value with. */
const TRUE_VALUES: ReadonlySet<string> = new Set(['1', 't', 'true'])
const FALSE_VALUES: ReadonlySet<string> = new Set(['0', 'f', 'false'])

/**
 * A mirrored env value as the platform types its key. `undefined` means the value cannot stand for
 * that key — an unset variable, or text where a number belongs — and the default answers instead.
 */
function parseMirrored(key: string, raw: string | undefined): unknown {
  // An empty variable is how a compose file spells "not configured"; it is not a value.
  if (raw === undefined || raw === '') return undefined

  const declared = PLATFORM_CONFIG_TYPES[key]

  if (declared === 'boolean') {
    const value = raw.trim().toLowerCase()
    if (TRUE_VALUES.has(value)) return true
    if (FALSE_VALUES.has(value)) return false
    return undefined
  }

  if (declared === 'number') {
    const value = Number(raw)
    return Number.isFinite(value) ? value : undefined
  }

  return raw
}

/** `true` for every template the UI has given a body or a subject of its own. */
function customContents(state: AuthConfigState, key: (id: TemplateId) => string) {
  const contents: Record<string, boolean> = {}

  for (const id of TEMPLATE_IDS) {
    const stored = state[key(id)]
    contents[key(id)] = typeof stored === 'string' && stored !== ''
  }

  return contents
}

/**
 * The auth config as it stands: what the UI has saved, else what GoTrue was started with, else
 * GoTrue's own default.
 *
 * GoTrue's config directory cannot be read back for this — keys there are sticky and the running
 * config mixes container env with every file in the directory — so Studio answers from its own
 * state file, the mirrored env, and the recorded defaults, in that order.
 */
export async function getAuthConfig(): Promise<GoTrueConfigResponse> {
  const state = await readState()
  const config: Record<string, unknown> = {}

  for (const key of RESOLVED_KEYS) {
    if (key in state) {
      config[key] = state[key]
      continue
    }

    const mirroredName = MIRRORED_BY_KEY.get(key)
    const mirrored =
      mirroredName === undefined ? undefined : parseMirrored(key, process.env[mirroredName])
    if (mirrored !== undefined) {
      config[key] = mirrored
      continue
    }

    // A key absent from `DEFAULTS` is one of the six the response type declares nullable.
    config[key] = key in DEFAULTS ? DEFAULTS[key as keyof typeof DEFAULTS] : null
  }

  config.MAILER_TEMPLATES_CUSTOM_CONTENTS = customContents(
    state,
    (id) => `MAILER_TEMPLATES_${id}_CONTENT`
  )
  config.MAILER_SUBJECTS_CUSTOM_CONTENTS = customContents(state, (id) => `MAILER_SUBJECTS_${id}`)

  // A hosted-plan quota, read by GoTrue from its licence rather than from the environment. Zero is
  // the answer here whatever a state file written by an older Studio holds.
  config.CUSTOM_OAUTH_MAX_PROVIDERS = 0

  return config as GoTrueConfigResponse
}

/** Renders the current config into the file GoTrue watches. */
async function writeGoTrueEnv(config: GoTrueConfigResponse): Promise<void> {
  const env = toEnv(config, {
    templateBaseUrl: `${process.env.STUDIO_INTERNAL_URL ?? 'http://supabase-studio:3000'}/api/platform/auth/default/templates`,
    apiExternalUrl: process.env.SUPABASE_PUBLIC_URL ?? '',
  })

  await writeEnvFile(renderEnvFile(env), getConfigDir())
}

/**
 * Applies a PATCH: validates it, records it, and rewrites `99_studio.env` from the result.
 *
 * `null` for a key removes it from the state, so the mirrored env or the default answers for it
 * again. An empty `SMTP_PASS` is dropped rather than stored — the UI sends the field back empty
 * because it never received the password it is editing, and storing that would clear it.
 */
export async function updateAuthConfig(
  patch: Record<string, unknown>
): Promise<GoTrueConfigResponse> {
  const incoming: Record<string, unknown> = { ...patch }

  // A client that saves what a GET handed it sends these back; they are Studio's own summary of
  // the state, not settings, and `validatePatch` refuses them.
  for (const key of COMPUTED_KEYS) delete incoming[key]
  if (incoming.SMTP_PASS === '') delete incoming.SMTP_PASS

  const result = validatePatch(incoming, await getAuthConfig())
  if (!result.ok) throw new AuthConfigValidationError(result.message)

  const state = await readState()
  for (const [key, value] of Object.entries(incoming)) {
    if (value === null) delete state[key]
    else state[key] = value
  }
  await writeState(state)

  const config = await getAuthConfig()
  await writeGoTrueEnv(config)

  return config
}

/** Drops the UI's own body and subject for one template, putting GoTrue back on its built-in one. */
export async function resetTemplate(id: TemplateId): Promise<GoTrueConfigResponse> {
  const state = await readState()

  delete state[`MAILER_TEMPLATES_${id}_CONTENT`]
  delete state[`MAILER_SUBJECTS_${id}`]
  await writeState(state)

  const config = await getAuthConfig()
  await writeGoTrueEnv(config)

  return config
}
