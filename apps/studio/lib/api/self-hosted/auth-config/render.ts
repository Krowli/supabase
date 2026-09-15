import { chmod, mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * GoTrue reads every `*.env` file in its config directory in name order, and files there override
 * the container env. The `99_` prefix puts Studio's file last, so what the UI writes wins.
 */
export const ENV_FILE_NAME = '99_studio.env'

const ENV_KEY = /^[A-Z][A-Z0-9_]*$/

export function getConfigDir(): string {
  return process.env.GOTRUE_CONFIG_DIR ?? '/etc/gotrue'
}

/** Backslash first — escaping it after the others would double-escape what they inserted. */
function escapeValue(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
}

/**
 * Renders `{ ENV_NAME: value }` as the file GoTrue reads. Keys are sorted so the same settings
 * always produce the same bytes, which keeps a no-op save from touching the file GoTrue watches.
 */
export function renderEnvFile(map: Record<string, string>): string {
  const keys = Object.keys(map).sort()

  for (const key of keys) {
    if (!ENV_KEY.test(key)) {
      throw new Error(`auth-config env key is not a valid environment variable name: ${key}`)
    }
  }

  return keys.map((key) => `${key}="${escapeValue(map[key])}"\n`).join('')
}

/**
 * Writes the env file atomically. GoTrue watches `*.env` in this directory and reloads on change,
 * so the partial write lands under a `.tmp` name it ignores and only the rename is observable.
 */
export async function writeEnvFile(content: string, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })

  const tmpPath = join(dir, `${ENV_FILE_NAME}.tmp`)
  // `mode` only applies when the file is created, so chmod covers the case where it already exists.
  await writeFile(tmpPath, content, { mode: 0o644 })
  await chmod(tmpPath, 0o644)
  await rename(tmpPath, join(dir, ENV_FILE_NAME))
}
