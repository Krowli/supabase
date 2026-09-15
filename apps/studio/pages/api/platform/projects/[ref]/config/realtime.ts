import { NextApiRequest, NextApiResponse } from 'next'

import { apiWrapper } from '@/lib/api/apiWrapper'
import {
  ServiceConfigValidationError,
  ServiceUnavailableError,
} from '@/lib/api/self-hosted/service-config/errors'
import {
  getRealtimeConfig,
  updateRealtimeConfig,
} from '@/lib/api/self-hosted/service-config/realtime'

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
  try {
    return res.status(200).json(await getRealtimeConfig())
  } catch (error) {
    if (error instanceof ServiceUnavailableError) {
      return res.status(502).json({ error: { message: error.message } })
    }
    throw error
  }
}

const handlePatch = async (req: NextApiRequest, res: NextApiResponse) => {
  const body: unknown = req.body

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return res
      .status(400)
      .json({ error: { message: 'Body must be an object of Realtime settings' } })
  }

  try {
    await updateRealtimeConfig(body)
    // The platform answers a Realtime config PATCH with 204 and no body, and the settings page
    // refetches rather than reading the response. Answering with one would be a contract the
    // generated client does not expect.
    return res.status(204).end()
  } catch (error) {
    if (error instanceof ServiceConfigValidationError) {
      return res.status(400).json({ error: { message: error.message } })
    }
    // Realtime could not be reached or refused the changeset. Not the client's fault, and not
    // something a retry against Studio would fix, so it is reported as the bad gateway it is.
    if (error instanceof ServiceUnavailableError) {
      return res.status(502).json({ error: { message: error.message } })
    }
    // Anything else is a failure to write, which the wrapper turns into a 500.
    throw error
  }
}
