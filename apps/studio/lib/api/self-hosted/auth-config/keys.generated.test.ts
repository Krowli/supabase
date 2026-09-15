import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { PLATFORM_CONFIG_KEYS } from './keys.generated'

/**
 * Walks up from the working directory to the repo root. `import.meta.url` is not a file URL under
 * the jsdom environment, and the working directory differs between `pnpm --filter studio` and a
 * run started from the repo root, so neither one alone locates the generated types.
 */
function findPlatformTypes(): string {
  let dir = process.cwd()

  for (let depth = 0; depth < 6; depth++) {
    const candidate = resolve(dir, 'packages/api-types/types/platform.d.ts')
    if (existsSync(candidate)) return candidate
    dir = dirname(dir)
  }

  throw new Error(`packages/api-types/types/platform.d.ts not found above ${process.cwd()}`)
}

const PLATFORM_TYPES = findPlatformTypes()

/**
 * The property names of one schema block in the generated types. Only properties at the block's own
 * indentation count: `GoTrueConfigResponse` nests two `*_CUSTOM_CONTENTS` objects that repeat
 * top-level names, and a property whose type spans several lines (`PASSWORD_REQUIRED_CHARACTERS` in
 * the update body is a union of string literals) puts nothing after the colon.
 */
function collectSchemaKeys(schema: string): string[] {
  const lines = readFileSync(PLATFORM_TYPES, 'utf8').split('\n')

  const start = lines.findIndex((line) => new RegExp(`^\\s+${schema}: \\{$`).test(line))
  if (start === -1) throw new Error(`${schema} not found in ${PLATFORM_TYPES}`)

  const blockIndent = lines[start].search(/\S/)
  const closing = new RegExp(`^${' '.repeat(blockIndent)}\\}$`)

  const keys: string[] = []
  for (let index = start + 1; index < lines.length; index++) {
    if (closing.test(lines[index])) return keys

    const match = lines[index].match(/^(\s+)([A-Z][A-Z0-9_]*)\??:/)
    if (match && match[1].length === blockIndent + 2) keys.push(match[2])
  }

  throw new Error(`${schema} is never closed in ${PLATFORM_TYPES}`)
}

describe('api/self-hosted/auth-config/keys.generated', () => {
  const response = collectSchemaKeys('GoTrueConfigResponse')
  const update = collectSchemaKeys('UpdateGoTrueConfigBody')

  it('finds both blocks in the generated types', () => {
    // Guards the parser: without this, an empty parse would make the comparison below vacuous.
    expect(response.length).toBeGreaterThan(200)
    expect(update.length).toBeGreaterThan(200)
    expect(response).toContain('SITE_URL')
    expect(update).toContain('SITE_URL')
  })

  it('reads the property that spans several lines', () => {
    // `PASSWORD_REQUIRED_CHARACTERS` has nothing after its colon in the update body. It is the one
    // key the obvious `\\??: (.+)$` pattern silently drops.
    expect(update).toContain('PASSWORD_REQUIRED_CHARACTERS')
  })

  it('matches the union of the response and the update body, regenerated', () => {
    const union = [...new Set([...response, ...update])].sort()

    expect([...PLATFORM_CONFIG_KEYS]).toEqual(union)
  })

  it('is sorted and free of duplicates', () => {
    expect(new Set(PLATFORM_CONFIG_KEYS).size).toBe(PLATFORM_CONFIG_KEYS.length)
    expect([...PLATFORM_CONFIG_KEYS]).toEqual([...PLATFORM_CONFIG_KEYS].sort())
  })

  it('keeps the keys the two blocks disagree about', () => {
    // The update body accepts five keys the response never returns, and returns three it does not
    // accept. Studio has to store all of them, so the union is the list, not either block.
    expect(update.filter((key) => !response.includes(key))).toEqual([
      'EXTERNAL_WORKOS_ENABLED',
      'EXTERNAL_X_CLIENT_ID',
      'EXTERNAL_X_EMAIL_OPTIONAL',
      'EXTERNAL_X_ENABLED',
      'EXTERNAL_X_SECRET',
    ])
    expect(response.filter((key) => !update.includes(key))).toEqual([
      'CUSTOM_OAUTH_MAX_PROVIDERS',
      'MAILER_SUBJECTS_CUSTOM_CONTENTS',
      'MAILER_TEMPLATES_CUSTOM_CONTENTS',
    ])
  })
})
