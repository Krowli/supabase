import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getStateDir,
  readJsonState,
  readState,
  STATE_FILE_NAME,
  writeJsonState,
  writeState,
} from './state'

describe('api/self-hosted/auth-config/state', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'studio-auth-state-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  describe('getStateDir', () => {
    it('falls back to /var/lib/studio when STUDIO_AUTH_STATE_DIR is unset', () => {
      vi.stubEnv('STUDIO_AUTH_STATE_DIR', undefined)

      expect(getStateDir()).toBe('/var/lib/studio')
    })

    it('reads STUDIO_AUTH_STATE_DIR at call time', () => {
      vi.stubEnv('STUDIO_AUTH_STATE_DIR', '/custom/state')

      expect(getStateDir()).toBe('/custom/state')
    })
  })

  describe('readState', () => {
    it('returns an empty state when the file does not exist', async () => {
      await expect(readState(dir)).resolves.toEqual({})
    })

    it('returns an empty state when the directory does not exist', async () => {
      await expect(readState(join(dir, 'never-created'))).resolves.toEqual({})
    })

    it('surfaces a read error that is not "file missing"', async () => {
      // Only ENOENT means "nothing saved yet". Any other read failure must not be reported as an
      // empty state, or a save would silently drop every setting the file already held.
      mkdirSync(join(dir, STATE_FILE_NAME))

      await expect(readState(dir)).rejects.toThrow(/EISDIR/)
    })

    it('throws when the file is not parsable JSON', async () => {
      writeFileSync(join(dir, STATE_FILE_NAME), '{ "SITE_URL": ')

      await expect(readState(dir)).rejects.toThrow(
        `auth-config state is not valid JSON: ${join(dir, STATE_FILE_NAME)}`
      )
    })

    it('throws when the file parses to something that is not an object', async () => {
      writeFileSync(join(dir, STATE_FILE_NAME), '["SITE_URL"]')

      await expect(readState(dir)).rejects.toThrow(
        `auth-config state is not valid JSON: ${join(dir, STATE_FILE_NAME)}`
      )
    })
  })

  describe('writeState', () => {
    it('round-trips a state object', async () => {
      const state = {
        SITE_URL: 'http://localhost:3000',
        JWT_EXP: 7200,
        MAILER_AUTOCONFIRM: true,
        SESSIONS_TIMEBOX: null,
      }

      await writeState(state, dir)

      await expect(readState(dir)).resolves.toEqual(state)
    })

    it('writes pretty-printed JSON ending in a newline', async () => {
      await writeState({ JWT_EXP: 7200 }, dir)

      expect(readFileSync(join(dir, STATE_FILE_NAME), 'utf8')).toBe('{\n  "JWT_EXP": 7200\n}\n')
    })

    it('creates the state directory when it is missing', async () => {
      const nested = join(dir, 'var', 'lib', 'studio')

      await writeState({ SITE_URL: 'http://localhost:3000' }, nested)

      await expect(readState(nested)).resolves.toEqual({ SITE_URL: 'http://localhost:3000' })
    })

    it('writes the file 0600 and leaves no temporary file behind', async () => {
      // The state holds SMTP passwords and OAuth secrets, so it must not be world-readable.
      await writeState({ SMTP_PASS: 'a-secret' }, dir)

      expect(statSync(join(dir, STATE_FILE_NAME)).mode & 0o777).toBe(0o600)
      expect(readdirSync(dir)).toEqual([STATE_FILE_NAME])
    })

    it('replaces the previous state rather than merging into it', async () => {
      await writeState({ SITE_URL: 'http://first', JWT_EXP: 7200 }, dir)
      await writeState({ SITE_URL: 'http://second' }, dir)

      await expect(readState(dir)).resolves.toEqual({ SITE_URL: 'http://second' })
    })

    it('keeps mode 0600 when overwriting an existing state file', async () => {
      await writeState({ SMTP_PASS: 'first' }, dir)
      await writeState({ SMTP_PASS: 'second' }, dir)

      expect(statSync(join(dir, STATE_FILE_NAME)).mode & 0o777).toBe(0o600)
    })

    it('leaves one readable state when two writes overlap', async () => {
      // Each write uses its own temp name, so concurrent saves cannot write into the same temp file
      // and rename a blend of the two into place.
      await Promise.all([
        writeState({ SITE_URL: 'http://first' }, dir),
        writeState({ SITE_URL: 'http://second' }, dir),
        writeState({ SITE_URL: 'http://third' }, dir),
      ])

      expect(readdirSync(dir)).toEqual([STATE_FILE_NAME])
      const state = await readState(dir)
      expect(['http://first', 'http://second', 'http://third']).toContain(state.SITE_URL)
    })
  })

  describe('readJsonState / writeJsonState', () => {
    const OTHER_FILE = 'postgrest-config.json'

    it('round-trips a state object under the name it was given', async () => {
      await writeJsonState(OTHER_FILE, { db_pool: 20 }, dir)

      expect(readdirSync(dir)).toEqual([OTHER_FILE])
      await expect(readJsonState(OTHER_FILE, dir)).resolves.toEqual({ db_pool: 20 })
    })

    it('returns an empty state when the file does not exist', async () => {
      await expect(readJsonState(OTHER_FILE, dir)).resolves.toEqual({})
    })

    it('keeps one service out of another service state file', async () => {
      await writeJsonState(OTHER_FILE, { db_pool: 20 }, dir)
      await writeState({ SITE_URL: 'http://localhost:3000' }, dir)

      await expect(readJsonState(OTHER_FILE, dir)).resolves.toEqual({ db_pool: 20 })
      await expect(readState(dir)).resolves.toEqual({ SITE_URL: 'http://localhost:3000' })
    })

    it('writes the file 0600 and leaves no temporary file behind', async () => {
      await writeJsonState(OTHER_FILE, { secret: 'a-secret' }, dir)

      expect(statSync(join(dir, OTHER_FILE)).mode & 0o777).toBe(0o600)
      expect(readdirSync(dir)).toEqual([OTHER_FILE])
    })

    it('creates the state directory when it is missing', async () => {
      const nested = join(dir, 'var', 'lib', 'studio')

      await writeJsonState(OTHER_FILE, { db_pool: 20 }, nested)

      await expect(readJsonState(OTHER_FILE, nested)).resolves.toEqual({ db_pool: 20 })
    })

    it('names the file in the error when it is not parsable JSON', async () => {
      writeFileSync(join(dir, OTHER_FILE), '{ "db_pool": ')

      await expect(readJsonState(OTHER_FILE, dir)).rejects.toThrow(
        `postgrest-config state is not valid JSON: ${join(dir, OTHER_FILE)}`
      )
    })

    it('throws when the file parses to something that is not an object', async () => {
      writeFileSync(join(dir, OTHER_FILE), '["db_pool"]')

      await expect(readJsonState(OTHER_FILE, dir)).rejects.toThrow(
        `postgrest-config state is not valid JSON: ${join(dir, OTHER_FILE)}`
      )
    })

    it('surfaces a read error that is not "file missing"', async () => {
      mkdirSync(join(dir, OTHER_FILE))

      await expect(readJsonState(OTHER_FILE, dir)).rejects.toThrow(/EISDIR/)
    })

    it.each([
      '../escape.json',
      'nested/state.json',
      'Auth-Config.json',
      'auth-config.yaml',
      'auth-config',
      '.json',
    ])('refuses to read or write %s', async (fileName) => {
      // The name is joined onto a directory path, so a caller must not be able to reach outside it.
      await expect(readJsonState(fileName, dir)).rejects.toThrow(
        `invalid state file name: ${fileName}`
      )
      await expect(writeJsonState(fileName, {}, dir)).rejects.toThrow(
        `invalid state file name: ${fileName}`
      )
      expect(readdirSync(dir)).toEqual([])
    })
  })
})
