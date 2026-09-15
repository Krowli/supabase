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
