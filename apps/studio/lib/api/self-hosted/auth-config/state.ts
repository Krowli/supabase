import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Studio's own record of the auth settings that were changed from the UI.
 *
 * GoTrue's config directory is not a source of truth we can read back: keys are sticky (removing a
 * line does not unset the value) and the running config mixes container env with every file in the
 * directory. So Studio keeps what it wrote here, and renders the env file from it.
 */
export const STATE_FILE_NAME = 'auth-config.json'

/** Flat `{ [platformKey]: value }` map, keyed by `GoTrueConfigResponse` property name. */
export type AuthConfigState = Record<string, unknown>

export function getStateDir(): string {
  return process.env.STUDIO_AUTH_STATE_DIR ?? '/var/lib/studio'
}

/** Distinguishes concurrent writes, so two saves in flight cannot share one temp file. */
let tmpSequence = 0

/**
 * Reads the state file. A missing file is not an error — it means nothing has been changed from the
 * UI yet, and every setting falls back to its default or mirrored env value.
 */
export async function readState(dir = getStateDir()): Promise<AuthConfigState> {
  const path = join(dir, STATE_FILE_NAME)

  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`auth-config state is not valid JSON: ${path}`)
  }

  // A JSON array, string or number parses fine but is not a state object.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`auth-config state is not valid JSON: ${path}`)
  }

  return parsed as AuthConfigState
}

/**
 * Writes the state file atomically: a reader either sees the previous file or the new one, never a
 * half-written one. Mode 0600 because the state holds SMTP passwords and OAuth secrets.
 */
export async function writeState(state: AuthConfigState, dir = getStateDir()): Promise<void> {
  await mkdir(dir, { recursive: true })

  tmpSequence += 1
  const tmpPath = join(dir, `${STATE_FILE_NAME}.tmp.${process.pid}.${tmpSequence}`)
  // `mode` only applies when the file is created, so chmod covers the case where it already exists.
  await writeFile(tmpPath, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 })
  await chmod(tmpPath, 0o600)
  await rename(tmpPath, join(dir, STATE_FILE_NAME))
}
