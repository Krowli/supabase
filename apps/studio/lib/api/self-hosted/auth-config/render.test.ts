import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ENV_FILE_NAME, getConfigDir, renderEnvFile, writeEnvFile } from './render'

describe('api/self-hosted/auth-config/render', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'studio-auth-env-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  describe('getConfigDir', () => {
    it('falls back to /etc/gotrue when GOTRUE_CONFIG_DIR is unset', () => {
      vi.stubEnv('GOTRUE_CONFIG_DIR', undefined)

      expect(getConfigDir()).toBe('/etc/gotrue')
    })

    it('reads GOTRUE_CONFIG_DIR at call time', () => {
      vi.stubEnv('GOTRUE_CONFIG_DIR', '/custom/gotrue')

      expect(getConfigDir()).toBe('/custom/gotrue')
    })
  })

  describe('renderEnvFile', () => {
    it('renders an empty map as an empty file', () => {
      expect(renderEnvFile({})).toBe('')
    })

    it('writes one quoted line per key and ends the file with a newline', () => {
      expect(renderEnvFile({ GOTRUE_SITE_URL: 'http://localhost:3000' })).toBe(
        'GOTRUE_SITE_URL="http://localhost:3000"\n'
      )
    })

    it('sorts keys ascending so the same settings always render the same bytes', () => {
      expect(renderEnvFile({ GOTRUE_SITE_URL: 'c', GOTRUE_JWT_EXP: 'a', GOTRUE_MAILER: 'b' })).toBe(
        'GOTRUE_JWT_EXP="a"\nGOTRUE_MAILER="b"\nGOTRUE_SITE_URL="c"\n'
      )
    })

    it('renders an empty value as an empty quoted string', () => {
      expect(renderEnvFile({ GOTRUE_SMTP_HOST: '' })).toBe('GOTRUE_SMTP_HOST=""\n')
    })

    it('escapes backslashes, double quotes, newlines and carriage returns', () => {
      const rendered = renderEnvFile({
        A: 'back\\slash',
        B: 'say "hi"',
        C: 'line1\nline2',
        D: 'cr\rend',
      })

      expect(rendered).toBe(
        'A="back\\\\slash"\nB="say \\"hi\\""\nC="line1\\nline2"\nD="cr\\rend"\n'
      )
    })

    it('escapes the backslash first, so a literal \\n stays distinct from a newline', () => {
      // Value is the two characters `\` and `n`, not a newline.
      expect(renderEnvFile({ A: '\\n' })).toBe('A="\\\\n"\n')
      // Value is an actual newline.
      expect(renderEnvFile({ A: '\n' })).toBe('A="\\n"\n')
    })

    it.each([
      'lowercase',
      'Mixed_Case',
      '1_LEADING_DIGIT',
      'HAS-DASH',
      'HAS SPACE',
      '_LEADING',
      '',
    ])('throws on the invalid env key %j', (key) => {
      // Passing an Error compares the message for equality, so the empty-key case asserts the whole
      // message instead of matching a prefix that happens to end in a space.
      expect(() => renderEnvFile({ [key]: 'value' })).toThrow(
        new Error(`auth-config env key is not a valid environment variable name: ${key}`)
      )
    })

    it('accepts digits and underscores after the first letter', () => {
      expect(renderEnvFile({ GOTRUE_EXTERNAL_WEB3_SOLANA_ENABLED: 'true' })).toBe(
        'GOTRUE_EXTERNAL_WEB3_SOLANA_ENABLED="true"\n'
      )
    })
  })

  describe('writeEnvFile', () => {
    it('writes the rendered content to 99_studio.env', async () => {
      const content = renderEnvFile({ GOTRUE_SITE_URL: 'http://localhost:3000' })

      await writeEnvFile(content, dir)

      expect(readFileSync(join(dir, ENV_FILE_NAME), 'utf8')).toBe(content)
    })

    it('creates the config directory when it is missing', async () => {
      const nested = join(dir, 'etc', 'gotrue')

      await writeEnvFile('A="b"\n', nested)

      expect(readFileSync(join(nested, ENV_FILE_NAME), 'utf8')).toBe('A="b"\n')
    })

    it('writes the file 0644 and leaves no temporary file behind', async () => {
      // GoTrue reads this file as its own user, and it watches `*.env` — a leftover `.tmp` would be
      // ignored by the watcher but would still be a half-written copy of the config on disk.
      await writeEnvFile('A="b"\n', dir)

      expect(statSync(join(dir, ENV_FILE_NAME)).mode & 0o777).toBe(0o644)
      expect(readdirSync(dir)).toEqual([ENV_FILE_NAME])
    })

    it('replaces the previous file on a second write', async () => {
      await writeEnvFile('A="first"\n', dir)
      await writeEnvFile('A="second"\n', dir)

      expect(readFileSync(join(dir, ENV_FILE_NAME), 'utf8')).toBe('A="second"\n')
      expect(statSync(join(dir, ENV_FILE_NAME)).mode & 0o777).toBe(0o644)
    })

    it('leaves one whole file when two writes overlap', async () => {
      // Each write uses its own temp name, so concurrent saves cannot write into the same temp file
      // and rename a blend of the two into place.
      await Promise.all([
        writeEnvFile('A="first"\n', dir),
        writeEnvFile('A="second"\n', dir),
        writeEnvFile('A="third"\n', dir),
      ])

      expect(readdirSync(dir)).toEqual([ENV_FILE_NAME])
      expect(['A="first"\n', 'A="second"\n', 'A="third"\n']).toContain(
        readFileSync(join(dir, ENV_FILE_NAME), 'utf8')
      )
    })
  })
})
