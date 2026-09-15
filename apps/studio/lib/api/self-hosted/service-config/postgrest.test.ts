import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_AUTH_JWT_SECRET, DEFAULT_EXPOSED_SCHEMAS } from '../constants'
import { ServiceConfigValidationError } from './errors'
import { getPostgrestConfig, updatePostgrestConfig } from './postgrest'

const { executeQuery } = vi.hoisted(() => ({ executeQuery: vi.fn() }))
vi.mock('../query', () => ({ executeQuery }))

/** The role settings the next read sees, as `pg_db_role_setting` hands them over. */
const withRoleSettings = (...settings: string[]) => {
  executeQuery.mockResolvedValue({
    data: settings.map((setting) => ({ setting })),
    error: undefined,
  })
}

/** The SQL of the call that wrote, which is always the first of the two an update makes. */
const writtenSql = (): string => executeQuery.mock.calls[0][0].query

describe('api/self-hosted/service-config/postgrest', () => {
  beforeEach(() => {
    executeQuery.mockReset()
    withRoleSettings()
    vi.unstubAllEnvs()
    // Cleared so a variable in the ambient environment cannot decide what a fallback answers with.
    vi.stubEnv('PGRST_DB_EXTRA_SEARCH_PATH', undefined)
    vi.stubEnv('PGRST_DB_MAX_ROWS', undefined)
    vi.stubEnv('AUTH_JWT_SECRET', undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('getPostgrestConfig', () => {
    it('asks for the settings of the authenticator role', async () => {
      await getPostgrestConfig()

      expect(executeQuery).toHaveBeenCalledTimes(1)
      expect(writtenSql()).toContain('pg_catalog.pg_db_role_setting')
      expect(writtenSql()).toContain("r.rolname = 'authenticator'")
    })

    it('reads the role settings PostgREST runs on', async () => {
      withRoleSettings(
        'pgrst.db_schemas=public,graphql_public,api',
        'pgrst.db_extra_search_path=public,extensions',
        'pgrst.db_max_rows=500',
        'pgrst.db_pool=25'
      )

      await expect(getPostgrestConfig()).resolves.toMatchObject({
        db_schema: 'public,graphql_public,api',
        db_extra_search_path: 'public,extensions',
        max_rows: 500,
        db_pool: 25,
      })
    })

    it('strips the quotes Postgres puts around a value holding a comma', async () => {
      withRoleSettings(
        'pgrst.db_schemas="public, graphql_public"',
        'pgrst.db_extra_search_path="public, extensions"'
      )

      await expect(getPostgrestConfig()).resolves.toMatchObject({
        db_schema: 'public, graphql_public',
        db_extra_search_path: 'public, extensions',
      })
    })

    it('keeps a value that itself contains an equals sign', async () => {
      withRoleSettings('pgrst.db_extra_search_path=a=b')

      await expect(getPostgrestConfig()).resolves.toMatchObject({ db_extra_search_path: 'a=b' })
    })

    it('ignores settings of other extensions and rows without a value', async () => {
      withRoleSettings('statement_timeout=8s', 'search_path', 'pgrst.db_max_rows=42')

      await expect(getPostgrestConfig()).resolves.toMatchObject({ max_rows: 42 })
    })

    it('falls back to the container env when nothing is set on the role', async () => {
      vi.stubEnv('PGRST_DB_EXTRA_SEARCH_PATH', 'public,extensions')
      vi.stubEnv('PGRST_DB_MAX_ROWS', '750')

      await expect(getPostgrestConfig()).resolves.toEqual({
        db_anon_role: 'anon',
        db_extra_search_path: 'public,extensions',
        db_pool: null,
        db_schema: DEFAULT_EXPOSED_SCHEMAS,
        jwt_secret: DEFAULT_AUTH_JWT_SECRET,
        max_rows: 750,
        role_claim_key: '.role',
      })
    })

    it('falls back to the built-in defaults when the env is empty too', async () => {
      await expect(getPostgrestConfig()).resolves.toMatchObject({
        db_extra_search_path: 'public',
        max_rows: 1000,
        db_pool: null,
      })
    })

    it('falls back to the env when a role setting is not an integer', async () => {
      vi.stubEnv('PGRST_DB_MAX_ROWS', '750')
      withRoleSettings('pgrst.db_max_rows=lots', 'pgrst.db_pool=big')

      await expect(getPostgrestConfig()).resolves.toMatchObject({ max_rows: 750, db_pool: null })
    })

    it('answers with the JWT secret the stack was started with', async () => {
      vi.stubEnv('AUTH_JWT_SECRET', 'a-secret-of-at-least-32-characters-long')

      await expect(getPostgrestConfig()).resolves.toMatchObject({
        jwt_secret: 'a-secret-of-at-least-32-characters-long',
      })
    })

    it('surfaces a database error rather than answering with the env', async () => {
      executeQuery.mockResolvedValue({ data: undefined, error: new Error('connection refused') })

      await expect(getPostgrestConfig()).rejects.toThrow('connection refused')
    })
  })

  describe('updatePostgrestConfig', () => {
    it('writes every field it was given, then tells PostgREST to reload', async () => {
      await updatePostgrestConfig({
        db_schema: 'public,graphql_public',
        db_extra_search_path: 'public,extensions',
        max_rows: 500,
        db_pool: 25,
        db_pool_acquisition_timeout: 10,
      })

      expect(writtenSql()).toBe(
        [
          "ALTER ROLE authenticator SET pgrst.db_schemas = 'public, graphql_public';",
          "ALTER ROLE authenticator SET pgrst.db_extra_search_path = 'public, extensions';",
          "ALTER ROLE authenticator SET pgrst.db_max_rows = '500';",
          "ALTER ROLE authenticator SET pgrst.db_pool = '25';",
          "ALTER ROLE authenticator SET pgrst.db_pool_acquisition_timeout = '10';",
          `NOTIFY pgrst, 'reload config';`,
        ].join('\n')
      )
    })

    it('sends the whole change as one statement, and reads back after it', async () => {
      await updatePostgrestConfig({ max_rows: 500 })

      expect(executeQuery).toHaveBeenCalledTimes(2)
      expect(writtenSql().endsWith(`NOTIFY pgrst, 'reload config';`)).toBe(true)
    })

    it('leaves the fields the body does not name alone', async () => {
      await updatePostgrestConfig({ max_rows: 500 })

      expect(writtenSql()).toBe(
        "ALTER ROLE authenticator SET pgrst.db_max_rows = '500';\nNOTIFY pgrst, 'reload config';"
      )
    })

    it('resets the pool size back to the env value when it is cleared', async () => {
      await updatePostgrestConfig({ db_pool: null })

      expect(writtenSql()).toBe(
        `ALTER ROLE authenticator RESET pgrst.db_pool;\nNOTIFY pgrst, 'reload config';`
      )
    })

    it('normalises the spacing of a schema list', async () => {
      await updatePostgrestConfig({ db_schema: ' public ,graphql_public,' })

      expect(writtenSql()).toContain(
        "ALTER ROLE authenticator SET pgrst.db_schemas = 'public, graphql_public';"
      )
    })

    it('writes an empty extra search path when every entry is cleared', async () => {
      await updatePostgrestConfig({ db_extra_search_path: '' })

      expect(writtenSql()).toContain(
        "ALTER ROLE authenticator SET pgrst.db_extra_search_path = '';"
      )
    })

    it('answers with the config as it now stands', async () => {
      executeQuery.mockResolvedValueOnce({ data: [], error: undefined })
      withRoleSettings('pgrst.db_schemas=public', 'pgrst.db_max_rows=500', 'pgrst.db_pool=25')

      await expect(
        updatePostgrestConfig({ db_schema: 'public', max_rows: 500, db_pool: 25 })
      ).resolves.toEqual({
        db_schema: 'public',
        db_extra_search_path: 'public',
        max_rows: 500,
        db_pool: 25,
        db_pool_acquisition_timeout: null,
      })
    })

    it('echoes the acquisition timeout it was given, which it cannot read back', async () => {
      await expect(
        updatePostgrestConfig({ db_pool_acquisition_timeout: 30 })
      ).resolves.toMatchObject({ db_pool_acquisition_timeout: 30 })
    })

    it('surfaces a database error', async () => {
      executeQuery.mockResolvedValue({ data: undefined, error: new Error('permission denied') })

      await expect(updatePostgrestConfig({ max_rows: 500 })).rejects.toThrow('permission denied')
    })

    describe('refuses, and writes nothing, when', () => {
      const rejects = [
        ['a schema name carries SQL', { db_schema: 'public; drop table x' }],
        ['a schema name is quoted', { db_schema: 'public, "my schema"' }],
        ['a schema name starts with a digit', { db_schema: '1public' }],
        ['a schema name is longer than an identifier', { db_schema: 'a'.repeat(64) }],
        ['a search path entry carries SQL', { db_extra_search_path: "public'--" }],
        ['the schema list is empty', { db_schema: '' }],
        ['the schema list is only separators', { db_schema: ' , ' }],
        ['the schema list is not a string', { db_schema: ['public'] }],
        ['max rows is zero', { max_rows: 0 }],
        ['max rows is above a million', { max_rows: 1_000_001 }],
        ['max rows is fractional', { max_rows: 1.5 }],
        ['max rows is a string', { max_rows: '500' }],
        ['the pool size is zero', { db_pool: 0 }],
        ['the pool size is above a thousand', { db_pool: 1001 }],
        ['the acquisition timeout is zero', { db_pool_acquisition_timeout: 0 }],
        ['the acquisition timeout is above ten minutes', { db_pool_acquisition_timeout: 601 }],
        ['the acquisition timeout is cleared', { db_pool_acquisition_timeout: null }],
      ] as const

      it.each(rejects)('%s', async (_name, body) => {
        await expect(
          updatePostgrestConfig(body as Parameters<typeof updatePostgrestConfig>[0])
        ).rejects.toBeInstanceOf(ServiceConfigValidationError)

        expect(executeQuery).not.toHaveBeenCalled()
      })
    })
  })
})
