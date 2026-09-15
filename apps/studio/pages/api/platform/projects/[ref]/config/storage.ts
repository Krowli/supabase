import { NextApiRequest, NextApiResponse } from 'next'

import { apiWrapper } from '@/lib/api/apiWrapper'
import { ServiceConfigValidationError } from '@/lib/api/self-hosted/service-config/errors'
import { getStorageConfig, updateStorageConfig } from '@/lib/api/self-hosted/service-config/storage'

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
  return res.status(200).json(await getStorageConfig())
}

const handlePatch = async (req: NextApiRequest, res: NextApiResponse) => {
  const body: unknown = req.body

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return res
      .status(400)
      .json({ error: { message: 'Body must be an object of storage settings' } })
  }

  try {
    // The platform answers this PATCH with the config as it now stands, and the mutation returns it.
    return res.status(200).json(await updateStorageConfig(body as Record<string, unknown>))
  } catch (error) {
    if (error instanceof ServiceConfigValidationError) {
      return res.status(400).json({ error: { message: error.message } })
    }
    // Anything else is a failure to write the state or the env file, which the wrapper turns into
    // a 500. There is no service to reach here — storage only reads the file at its next start.
    throw error
  }
}
