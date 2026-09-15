import { NextApiRequest, NextApiResponse } from 'next'

import { apiWrapper } from '@/lib/api/apiWrapper'

export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req

  switch (method) {
    case 'GET':
      return handleGetAll(req, res)
    default:
      res.setHeader('Allow', ['GET'])
      res.status(405).json({ data: null, error: { message: `Method ${method} Not Allowed` } })
  }
}

const handleGetAll = async (_req: NextApiRequest, res: NextApiResponse) => {
  // Platform specific endpoint
  const response = [
    {
      id: 1,
      name: process.env.DEFAULT_ORGANIZATION_NAME || 'Default Organization',
      slug: 'default-org-slug',
      billing_email: 'billing@supabase.co',
      plan: {
        id: 'enterprise',
        name: 'Enterprise',
      },
      // There is no spend cap self-hosted — nobody is billed for anything. Several settings pages
      // read this flag to decide whether a usage-based field may be edited at all (the Realtime
      // rate limits, for one), and a missing flag reads as "spend cap on" and disables them.
      usage_billing_enabled: true,
    },
  ]
  return res.status(200).json(response)
}
