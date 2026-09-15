import { NextApiRequest, NextApiResponse } from 'next'

import { apiWrapper } from '@/lib/api/apiWrapper'
import {
  ServiceConfigNotFoundError,
  ServiceConfigValidationError,
} from '@/lib/api/self-hosted/service-config/errors'
import { deleteCredential } from '@/lib/api/self-hosted/service-config/storage'

export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req

  switch (method) {
    case 'DELETE':
      return handleDelete(req, res)
    default:
      res.setHeader('Allow', ['DELETE'])
      res.status(405).json({ data: null, error: { message: `Method ${method} Not Allowed` } })
  }
}

const handleDelete = async (req: NextApiRequest, res: NextApiResponse) => {
  const { id } = req.query
  const credentialId = Array.isArray(id) ? id[0] : id

  if (!credentialId) {
    return res.status(400).json({ error: { message: 'An access key id is required' } })
  }

  try {
    await deleteCredential(credentialId)
    // The platform answers a revoke with 204 and no body.
    return res.status(204).end()
  } catch (error) {
    if (error instanceof ServiceConfigNotFoundError) {
      return res.status(404).json({ error: { message: error.message } })
    }
    if (error instanceof ServiceConfigValidationError) {
      return res.status(400).json({ error: { message: error.message } })
    }
    throw error
  }
}
