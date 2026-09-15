import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { PLATFORM_CONFIG_TYPES, PlatformValueType } from './keys.generated'

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
 * The properties of one schema block in the generated types, each with its type text.
 *
 * Only properties at the block's own indentation count: `GoTrueConfigResponse` nests two
 * `*_CUSTOM_CONTENTS` objects that repeat top-level names. A type that spans several lines — the
 * two nested objects, and the four unions of string literals — is joined onto the property it
 * belongs to; doc comments between properties are dropped.
 */
function collectSchema(schema: string): Map<string, string> {
  const lines = readFileSync(PLATFORM_TYPES, 'utf8').split('\n')

  const start = lines.findIndex((line) => new RegExp(`^\\s+${schema}: \\{$`).test(line))
  if (start === -1) throw new Error(`${schema} not found in ${PLATFORM_TYPES}`)

  const indent = lines[start].search(/\S/)
  const closing = new RegExp(`^ {${indent}}\\}$`)
  const property = new RegExp(`^ {${indent + 2}}([A-Z][A-Z0-9_]*)\\??:(.*)$`)

  const properties = new Map<string, string>()
  let current: string | null = null

  for (let index = start + 1; index < lines.length; index++) {
    if (closing.test(lines[index])) return properties

    const match = lines[index].match(property)
    if (match) {
      current = match[1]
      properties.set(current, match[2].trim())
      continue
    }

    const text = lines[index].trim()
    if (current !== null && text !== '' && !text.startsWith('/*') && !text.startsWith('*'))
      properties.set(current, `${properties.get(current)} ${text}`.trim())
  }

  throw new Error(`${schema} is never closed in ${PLATFORM_TYPES}`)
}

/**
 * Splits a union on its top-level `|`. Quote-aware, because one literal of
 * `PASSWORD_REQUIRED_CHARACTERS` contains a `|` and a naive split cuts it in half.
 */
function splitUnion(text: string): string[] {
  const parts: string[] = []
  let buffer = ''
  let index = 0

  while (index < text.length) {
    if (text[index] === "'") {
      let literal = "'"
      index++
      while (index < text.length) {
        if (text[index] === '\\') {
          literal += text[index] + text[index + 1]
          index += 2
          continue
        }
        if (text[index] === "'") {
          literal += "'"
          index++
          break
        }
        literal += text[index]
        index++
      }
      buffer += literal
      continue
    }

    if (text[index] === '|') {
      parts.push(buffer.trim())
      buffer = ''
      index++
      continue
    }

    buffer += text[index]
    index++
  }

  parts.push(buffer.trim())
  return parts.filter((part) => part !== '')
}

/** The runtime value of a TypeScript single-quoted literal. */
function unquote(literal: string): string {
  const body = literal.slice(1, -1)
  let out = ''

  for (let index = 0; index < body.length; index++) {
    if (body[index] === '\\') {
      out += body[index + 1]
      index++
      continue
    }
    out += body[index]
  }

  return out
}

/** The declared type of one property, in the shape `keys.generated.ts` records. */
function classify(key: string, text: string): PlatformValueType {
  const members = splitUnion(text).filter((member) => member !== 'null')

  if (members.length === 1 && /^(string|number|boolean)$/.test(members[0])) {
    return members[0] as PlatformValueType
  }
  if (members.length === 1 && members[0].startsWith('{')) return 'object'
  if (members.every((member) => member.startsWith("'") && member.endsWith("'")))
    return members.map(unquote)

  throw new Error(`cannot classify ${key}: ${text}`)
}

function regenerate(): Record<string, PlatformValueType> {
  const response = collectSchema('GoTrueConfigResponse')
  const update = collectSchema('UpdateGoTrueConfigBody')

  const table: Record<string, PlatformValueType> = {}
  for (const key of [...new Set([...response.keys(), ...update.keys()])].sort()) {
    // The update body wins where the two disagree: this table validates an incoming PATCH.
    const text = update.get(key) ?? response.get(key)
    table[key] = classify(key, text as string)
  }

  return table
}

describe('api/self-hosted/auth-config/keys.generated', () => {
  const response = collectSchema('GoTrueConfigResponse')
  const update = collectSchema('UpdateGoTrueConfigBody')

  it('finds both blocks in the generated types', () => {
    // Guards the parser: without this, an empty parse would make the comparisons below vacuous.
    expect(response.size).toBeGreaterThan(200)
    expect(update.size).toBeGreaterThan(200)
    expect(response.get('SITE_URL')).toBe('string')
    expect(update.get('SITE_URL')).toBe('string | null')
  })

  it('reads the property whose type spans several lines', () => {
    // `PASSWORD_REQUIRED_CHARACTERS` has nothing after its colon in the update body. It is the one
    // key a `\\??: (.+)$` pattern silently drops, and its literals contain a `|` of their own.
    expect(update.get('PASSWORD_REQUIRED_CHARACTERS')).toContain("| ''")
    expect(
      classify('PASSWORD_REQUIRED_CHARACTERS', update.get('PASSWORD_REQUIRED_CHARACTERS')!)
    ).toHaveLength(4)
  })

  it('matches the table regenerated from both blocks', () => {
    expect(PLATFORM_CONFIG_TYPES).toEqual(regenerate())
  })

  it('is sorted and free of duplicates', () => {
    const keys = Object.keys(PLATFORM_CONFIG_TYPES)

    expect(keys).toHaveLength(242)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toEqual([...keys].sort())
  })

  it('records only the four kinds of declared type', () => {
    const kinds = new Set(
      Object.values(PLATFORM_CONFIG_TYPES).map((type) => (Array.isArray(type) ? 'enum' : type))
    )

    expect([...kinds].sort()).toEqual(['boolean', 'enum', 'number', 'object', 'string'])
  })

  it('takes the update body type where the two blocks disagree', () => {
    // Each of these is a plain `string` in the response and a fixed set of values in the body a
    // client may send. Validating against the looser one would accept a value the platform rejects.
    expect(PLATFORM_CONFIG_TYPES.SECURITY_CAPTCHA_PROVIDER).toEqual(['turnstile', 'hcaptcha'])
    expect(PLATFORM_CONFIG_TYPES.SMS_PROVIDER).toEqual([
      'messagebird',
      'textlocal',
      'twilio',
      'twilio_verify',
      'vonage',
    ])
    expect(PLATFORM_CONFIG_TYPES.PASSWORD_REQUIRED_CHARACTERS).toContain('')
    expect(response.get('SECURITY_CAPTCHA_PROVIDER')).toBe('string')
    expect(response.get('SMS_PROVIDER')).toBe('string')
    expect(response.get('PASSWORD_REQUIRED_CHARACTERS')).toBe('string')
  })

  it('keeps the keys the two blocks disagree about', () => {
    // The update body accepts five keys the response never returns, and returns three it does not
    // accept. Studio has to store all of them, so the union is the list, not either block.
    expect([...update.keys()].filter((key) => !response.has(key))).toEqual([
      'EXTERNAL_WORKOS_ENABLED',
      'EXTERNAL_X_CLIENT_ID',
      'EXTERNAL_X_EMAIL_OPTIONAL',
      'EXTERNAL_X_ENABLED',
      'EXTERNAL_X_SECRET',
    ])
    expect([...response.keys()].filter((key) => !update.has(key))).toEqual([
      'CUSTOM_OAUTH_MAX_PROVIDERS',
      'MAILER_SUBJECTS_CUSTOM_CONTENTS',
      'MAILER_TEMPLATES_CUSTOM_CONTENTS',
    ])
  })
})
