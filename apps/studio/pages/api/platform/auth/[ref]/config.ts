import { NextApiRequest, NextApiResponse } from 'next'

import { apiWrapper } from '@/lib/api/apiWrapper'
import {
  AuthConfigValidationError,
  getAuthConfig,
  updateAuthConfig,
} from '@/lib/api/self-hosted/auth-config'

export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req

  switch (method) {
    case 'GET':
      return handleGet(req, res)
    case 'PATCH':
      return handlePatch(req, res)
    default:
      res.setHeader('Allow', ['GET', 'PATCH'])
      res.status(405).json({ data: null, error: { message: `Method ${method} Not Allowed` } })
  }
}

const handleGet = async (_req: NextApiRequest, res: NextApiResponse) => {
  return res.status(200).json(await getAuthConfig())
}

const handlePatch = async (req: NextApiRequest, res: NextApiResponse) => {
  const body: unknown = req.body

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return res.status(400).json({ error: { message: 'Body must be an object of auth settings' } })
  }

  try {
    return res.status(200).json(await updateAuthConfig(body as Record<string, unknown>))
  } catch (error) {
    // Anything else is a failure to write, which the wrapper turns into a 500.
    if (error instanceof AuthConfigValidationError) {
      return res.status(400).json({ error: { message: error.message } })
    }
    throw error
  }
}
