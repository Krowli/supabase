import { NextApiRequest, NextApiResponse } from 'next'

import { apiWrapper } from '@/lib/api/apiWrapper'
import { AuthConfigValidationError, updateAuthConfig } from '@/lib/api/self-hosted/auth-config'

export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req

  switch (method) {
    case 'PATCH':
      return handlePatch(req, res)
    default:
      res.setHeader('Allow', ['PATCH'])
      res.status(405).json({ data: null, error: { message: `Method ${method} Not Allowed` } })
  }
}

/**
 * The hooks half of the auth config. The body is
 * `components['schemas']['UpdateGoTrueConfigHooksBody']`, every property of which is a `HOOK_` key;
 * anything else belongs to the config route and is refused here rather than quietly written,
 * because this route is the one the UI reaches for when it saves a single hook.
 */
const handlePatch = async (req: NextApiRequest, res: NextApiResponse) => {
  const body: unknown = req.body

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return res.status(400).json({ error: { message: 'Body must be an object of hook settings' } })
  }

  const patch = body as Record<string, unknown>
  const foreign = Object.keys(patch).filter((key) => !key.startsWith('HOOK_'))

  if (foreign.length > 0) {
    return res
      .status(400)
      .json({ error: { message: `Not an auth hook setting: ${foreign.join(', ')}` } })
  }

  try {
    return res.status(200).json(await updateAuthConfig(patch))
  } catch (error) {
    if (error instanceof AuthConfigValidationError) {
      return res.status(400).json({ error: { message: error.message } })
    }
    throw error
  }
}
