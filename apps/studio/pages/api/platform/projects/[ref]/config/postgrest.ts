import { NextApiRequest, NextApiResponse } from 'next'

import { apiWrapper } from '@/lib/api/apiWrapper'
import { ServiceConfigValidationError } from '@/lib/api/self-hosted/service-config/errors'
import {
  getPostgrestConfig,
  updatePostgrestConfig,
} from '@/lib/api/self-hosted/service-config/postgrest'

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
  return res.status(200).json(await getPostgrestConfig())
}

const handlePatch = async (req: NextApiRequest, res: NextApiResponse) => {
  const body: unknown = req.body

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return res
      .status(400)
      .json({ error: { message: 'Body must be an object of Data API settings' } })
  }

  try {
    return res.status(200).json(await updatePostgrestConfig(body))
  } catch (error) {
    // Anything else is a failure to write, which the wrapper turns into a 500.
    if (error instanceof ServiceConfigValidationError) {
      return res.status(400).json({ error: { message: error.message } })
    }
    throw error
  }
}
