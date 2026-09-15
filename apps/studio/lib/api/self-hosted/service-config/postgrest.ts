import { components } from 'api-types'

import { DEFAULT_AUTH_JWT_SECRET, DEFAULT_EXPOSED_SCHEMAS } from '../constants'
import { executeQuery } from '../query'
import { ServiceConfigValidationError } from './errors'

type GetPostgrestConfigResponse = components['schemas']['GetPostgrestConfigResponse_Output']
type UpdatePostgrestConfigBody = components['schemas']['UpdatePostgrestConfigBody']
type UpdatePostgrestConfigResponse = components['schemas']['UpdatePostgrestConfigResponse_Output']

/** `db_pool` is part of the platform's answer but missing from the generated type. */
export type PostgrestConfig = GetPostgrestConfigResponse & { db_pool: number | null }

/**
 * `UpdatePostgrestConfigBody`, plus the `db_pool: null` that asks for the env value back. The
 * generated type spells the field `number | undefined`, which leaves no way to say "cleared" —
 * undefined already means "not part of this PATCH". Every body the generated type accepts is
 * accepted here too.
 */
export type UpdatePostgrestConfigInput = Omit<UpdatePostgrestConfigBody, 'db_pool'> & {
  db_pool?: number | null
}

/**
 * PostgREST's in-database configuration: settings on the `authenticator` role, which override the
 * container env the service was started with. Reading them back is how Studio can answer with what
 * PostgREST is running on rather than with what the compose file once said.
 *
 * `setconfig` is a `text[]` of `name=value`, one array per (role, database) pair, so a role
 * configured both globally and per database yields more than one row.
 *
 * Three of the four settings this module writes are in-database settings and reload without a
 * restart: `db-schemas`, `db-extra-search-path` and `db-max-rows`. **`db-pool` and
 * `db-pool-acquisition-timeout` are neither** — the PostgREST 14 reference gives both "In-Database:
 * n/a" and "Reloadable: N", so a `pgrst.db_pool` on the role is a GUC nothing reads, and the pool
 * size can only be changed by the container env plus a restart. They are written and read here
 * because the platform's contract carries them; the value the UI shows after a save is the value
 * Studio stored, not the pool PostgREST is running on.
 * See https://docs.postgrest.org/en/v14/references/configuration.html#db-pool.
 */
const ROLE_SETTINGS_QUERY = `select unnest(s.setconfig) as setting
from pg_catalog.pg_db_role_setting s
join pg_catalog.pg_roles r on r.oid = s.setrole
where r.rolname = 'authenticator'`

type RoleSettingRow = { setting?: unknown }

/** A Postgres schema name, and the length Postgres truncates identifiers at. */
const SCHEMA_NAME = /^[A-Za-z_][A-Za-z0-9_$]*$/
const MAX_IDENTIFIER_LENGTH = 63

/**
 * Strips the one layer of double quotes Postgres adds around a setting value that holds a comma,
 * so `pgrst.db_schemas="public, graphql_public"` reads back as the list that was written.
 */
function unquote(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value
}

function parseRoleSettings(rows: readonly RoleSettingRow[]): Map<string, string> {
  const settings = new Map<string, string>()

  for (const row of rows) {
    const setting = row?.setting
    if (typeof setting !== 'string') continue

    const separator = setting.indexOf('=')
    if (separator === -1) continue

    settings.set(setting.slice(0, separator), unquote(setting.slice(separator + 1)))
  }

  return settings
}

/**
 * A setting Postgres holds as text, read back as a number. Anything that is not an integer — a
 * value someone set by hand, or a unit suffix — falls back to the env value rather than to `NaN`.
 */
function parseInteger(value: string | undefined): number | null {
  if (value === undefined) return null

  const trimmed = value.trim()
  if (!/^-?\d+$/.test(trimmed)) return null

  return Number(trimmed)
}

/**
 * The Data API settings as PostgREST would resolve them: a role setting where one is set, and the
 * env the container was started with everywhere else.
 */
export async function getPostgrestConfig(): Promise<PostgrestConfig> {
  const { data, error } = await executeQuery<RoleSettingRow>({ query: ROLE_SETTINGS_QUERY })
  if (error) throw error

  const settings = parseRoleSettings(data ?? [])

  return {
    db_anon_role: 'anon',
    db_extra_search_path:
      settings.get('pgrst.db_extra_search_path') ??
      process.env.PGRST_DB_EXTRA_SEARCH_PATH ??
      'public',
    db_pool: parseInteger(settings.get('pgrst.db_pool')),
    db_schema: settings.get('pgrst.db_schemas') ?? DEFAULT_EXPOSED_SCHEMAS,
    jwt_secret: process.env.AUTH_JWT_SECRET ?? DEFAULT_AUTH_JWT_SECRET,
    max_rows:
      parseInteger(settings.get('pgrst.db_max_rows')) ??
      (Number(process.env.PGRST_DB_MAX_ROWS) || 1000),
    role_claim_key: '.role',
  }
}

/**
 * A comma-separated list of schema names, normalised to the names themselves. Every name is checked
 * against {@link SCHEMA_NAME} because the result is interpolated into SQL — a name that passes
 * cannot carry a quote, a semicolon or a space, so there is nothing left in it to escape.
 */
function validateSchemaList(
  value: unknown,
  field: string,
  { allowEmpty }: { allowEmpty: boolean }
): string {
  if (typeof value !== 'string') {
    throw new ServiceConfigValidationError(
      `${field} must be a comma-separated list of schema names`
    )
  }

  const names = value
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '')

  if (names.length === 0) {
    if (allowEmpty) return ''
    throw new ServiceConfigValidationError(`${field} must name at least one schema`)
  }

  for (const name of names) {
    if (!SCHEMA_NAME.test(name) || name.length > MAX_IDENTIFIER_LENGTH) {
      throw new ServiceConfigValidationError(`${field} is not a valid schema name: ${name}`)
    }
  }

  return names.join(', ')
}

function validateInteger(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new ServiceConfigValidationError(`${field} must be an integer between ${min} and ${max}`)
  }

  return value
}

/** Safe to quote rather than escape: every value reaching here passed the validation above. */
const setSetting = (name: string, value: string) =>
  `ALTER ROLE authenticator SET pgrst.${name} = '${value}';`

/**
 * Writes the settings PostgREST reads from the database and tells it to pick them up.
 *
 * Only the fields the body carries are written — a PATCH names what changed, and resetting the rest
 * to their env values would undo settings the operator never touched. `db_pool: null` is the one
 * way to ask for the env value back, and it is a RESET rather than a write.
 */
export async function updatePostgrestConfig(
  body: UpdatePostgrestConfigInput
): Promise<UpdatePostgrestConfigResponse> {
  // The body is parsed JSON from a request, so it is read as unknown rather than trusted as typed.
  const fields = body as Record<string, unknown>
  const statements: string[] = []

  if (fields.db_schema !== undefined) {
    const schemas = validateSchemaList(fields.db_schema, 'db_schema', { allowEmpty: false })
    statements.push(setSetting('db_schemas', schemas))
  }

  if (fields.db_extra_search_path !== undefined) {
    const searchPath = validateSchemaList(fields.db_extra_search_path, 'db_extra_search_path', {
      allowEmpty: true,
    })
    statements.push(setSetting('db_extra_search_path', searchPath))
  }

  if (fields.max_rows !== undefined) {
    const maxRows = validateInteger(fields.max_rows, 'max_rows', 1, 1_000_000)
    statements.push(setSetting('db_max_rows', String(maxRows)))
  }

  if (fields.db_pool === null) {
    statements.push('ALTER ROLE authenticator RESET pgrst.db_pool;')
  } else if (fields.db_pool !== undefined) {
    const dbPool = validateInteger(fields.db_pool, 'db_pool', 1, 1000)
    statements.push(setSetting('db_pool', String(dbPool)))
  }

  // Not a role setting Studio reads back, so the answer can only echo what this request set.
  let dbPoolAcquisitionTimeout: number | null = null
  if (fields.db_pool_acquisition_timeout !== undefined) {
    dbPoolAcquisitionTimeout = validateInteger(
      fields.db_pool_acquisition_timeout,
      'db_pool_acquisition_timeout',
      1,
      600
    )
    statements.push(setSetting('db_pool_acquisition_timeout', String(dbPoolAcquisitionTimeout)))
  }

  // One statement short of useless on its own, but a reload with nothing changed costs nothing and
  // keeps an empty PATCH on the same path as every other one.
  statements.push(`NOTIFY pgrst, 'reload config';`)

  const { error } = await executeQuery({ query: statements.join('\n') })
  if (error) throw error

  const config = await getPostgrestConfig()

  return {
    db_extra_search_path: config.db_extra_search_path,
    db_pool: config.db_pool,
    db_pool_acquisition_timeout: dbPoolAcquisitionTimeout,
    db_schema: config.db_schema,
    max_rows: config.max_rows,
  }
}
