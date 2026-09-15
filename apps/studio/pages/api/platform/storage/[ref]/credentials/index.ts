import { NextApiRequest, NextApiResponse } from 'next'

import { apiWrapper } from '@/lib/api/apiWrapper'
import { ServiceConfigValidationError } from '@/lib/api/self-hosted/service-config/errors'
import { createCredential, listCredentials } from '@/lib/api/self-hosted/service-config/storage'

export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req

  switch (method) {
    case 'GET':
      return handleGet(req, res)
    case 'POST':
      return handlePost(req, res)
    default:
      res.setHeader('Allow', ['GET', 'POST'])
      res.status(405).json({ data: null, error: { message: `Method ${method} Not Allowed` } })
  }
}

const handleGet = async (_req: NextApiRequest, res: NextApiResponse) => {
  return res.status(200).json(await listCredentials())
}

const handlePost = async (req: NextApiRequest, res: NextApiResponse) => {
  const body: unknown = req.body

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return res.status(400).json({ error: { message: 'Body must be an object with a description' } })
  }

  try {
    const { description } = body as { description?: unknown }
    return res.status(200).json(await createCredential(description))
  } catch (error) {
    if (error instanceof ServiceConfigValidationError) {
      return res.status(400).json({ error: { message: error.message } })
    }
    throw error
  }
}
