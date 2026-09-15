import { ServiceUnavailableError } from './errors'

/**
 * How long a service on the compose network gets to answer. Every call behind this helper is a
 * small admin request to a neighbouring container, so anything approaching ten seconds means the
 * service is wedged rather than busy, and a settings page that hangs is worse than one that says
 * the service could not be reached.
 */
const TIMEOUT_MS = 10_000

/** Enough of the service's own words to act on, without pasting a stack trace into a toast. */
const MAX_DETAIL = 300

const truncate = (text: string): string =>
  text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL)}…` : text

export type AdminFetchInit = Omit<RequestInit, 'signal'> & { token: string }

/**
 * One request to a service's admin API, with the bearer token it expects.
 *
 * Every failure arrives as {@link ServiceUnavailableError} — a refused connection, a timeout, a
 * 403 from a mismatched JWT secret, a 422 from a changeset the service rejected. They are one class
 * because they are one thing from the operator's side: the request was well-formed and the service
 * behind it did not apply it. The response text rides along in the message, because "422" alone
 * does not say which field the service refused.
 *
 * The parsed JSON body is returned as `unknown`: what a service answers with is not something this
 * layer can vouch for, so the caller narrows it. A body that is empty or not JSON reads as
 * `undefined` rather than throwing — a 204 is still a success.
 */
export async function adminFetch(url: string, init: AdminFetchInit): Promise<unknown> {
  const { token, headers, ...rest } = init

  let response: Response
  try {
    response = await fetch(url, {
      ...rest,
      headers: {
        ...headers,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    // A timeout arrives here as an abort, indistinguishable in shape from a refused connection.
    const reason = error instanceof Error ? error.message : String(error)
    throw new ServiceUnavailableError(`Could not reach ${url}: ${truncate(reason)}`)
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    const suffix = detail === '' ? '' : `: ${truncate(detail)}`
    throw new ServiceUnavailableError(`${url} answered ${response.status}${suffix}`)
  }

  const body = await response.text().catch(() => '')
  if (body === '') return undefined

  try {
    return JSON.parse(body)
  } catch {
    throw new ServiceUnavailableError(
      `${url} answered with a body that is not JSON: ${truncate(body)}`
    )
  }
}
