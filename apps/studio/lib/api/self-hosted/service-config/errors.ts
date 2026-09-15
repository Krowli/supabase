/**
 * A PATCH the service behind the setting would refuse or misread. The route answers it with a 400.
 *
 * One class for every service under `service-config/`, because a handler only has to tell "the
 * client sent something wrong" apart from "we failed to apply it" — the first is a 400, the second
 * is left to `apiWrapper`, which turns it into a 500.
 */
export class ServiceConfigValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServiceConfigValidationError'
  }
}

/**
 * A service behind a setting could not be reached, or answered with a failure. The route answers it
 * with a 502: the request was fine, the thing behind it was not, and the operator needs to see that
 * the difference is not their input.
 *
 * Distinct from {@link ServiceConfigValidationError} — a 400 — and from everything else, which
 * `apiWrapper` turns into a 500.
 */
export class ServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServiceUnavailableError'
  }
}

/**
 * The thing the request addressed by id is not there. The route answers it with a 404.
 *
 * Distinct from {@link ServiceConfigValidationError} because the body was well formed — revoking an
 * S3 access key that has already been revoked is not a malformed request, and a 400 would send the
 * operator looking for a mistake in what they sent.
 */
export class ServiceConfigNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServiceConfigNotFoundError'
  }
}
