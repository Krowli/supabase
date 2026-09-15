import { NextApiRequest, NextApiResponse } from 'next'

import { apiWrapper } from '@/lib/api/apiWrapper'
import { ServiceUnavailableError } from '@/lib/api/self-hosted/service-config/errors'
import { getSupavisorConfig } from '@/lib/api/self-hosted/service-config/supavisor'

export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req

  switch (method) {
    case 'GET':
      return handleGet(req, res)
    default:
      res.setHeader('Allow', ['GET'])
      res.status(405).json({ data: null, error: { message: `Method ${method} Not Allowed` } })
  }
}

const handleGet = async (_req: NextApiRequest, res: NextApiResponse) => {
  try {
    return res.status(200).json(await getSupavisorConfig())
  } catch (error) {
    if (error instanceof ServiceUnavailableError) {
      return res.status(502).json({ error: { message: error.message } })
    }
    throw error
  }
}
