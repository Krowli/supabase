import { NextApiRequest, NextApiResponse } from 'next'

import { apiWrapper } from '@/lib/api/apiWrapper'
import { getAuthConfig, TEMPLATE_IDS, type TemplateId } from '@/lib/api/self-hosted/auth-config'

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

/**
 * The id in the path as `TEMPLATE_IDS` spells it, or `undefined` for anything else.
 *
 * `mapping.ts` builds the URL GoTrue fetches from `templateId.toLowerCase()`, so the path segment
 * arriving here is `magic_link` for `MAGIC_LINK`. Uppercasing is the whole mapping; the underscores
 * already match.
 */
function templateIdOf(raw: string | string[] | undefined): TemplateId | undefined {
  if (typeof raw !== 'string') return undefined

  const id = raw.toUpperCase()
  return (TEMPLATE_IDS as readonly string[]).includes(id) ? (id as TemplateId) : undefined
}

/**
 * The email template body GoTrue renders for this template.
 *
 * GoTrue takes a URL for a template, never the body, so Studio hands it this address and serves
 * the HTML the UI saved. That makes this the one route in the self-hosted set GoTrue itself calls,
 * over the container network and with no credentials — so it answers HTML rather than JSON and
 * stays unauthenticated. A template nobody has customised is a 404, which is how GoTrue is told to
 * fall back to its own built-in one, and the answer is never cached because the next save changes
 * it.
 */
const handleGet = async (req: NextApiRequest, res: NextApiResponse) => {
  const id = templateIdOf(req.query.template)
  if (id === undefined) {
    return res.status(404).json({ error: { message: 'Unknown template' } })
  }

  const config = await getAuthConfig()
  const content = config[`MAILER_TEMPLATES_${id}_CONTENT`]

  if (typeof content !== 'string' || content === '') {
    return res.status(404).json({ error: { message: 'Template not customised' } })
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).send(content)
}
