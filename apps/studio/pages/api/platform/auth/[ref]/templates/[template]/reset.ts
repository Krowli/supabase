import { NextApiRequest, NextApiResponse } from 'next'

import { apiWrapper } from '@/lib/api/apiWrapper'
import { resetTemplate, TEMPLATE_IDS, type TemplateId } from '@/lib/api/self-hosted/auth-config'

export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req

  switch (method) {
    case 'POST':
      return handlePost(req, res)
    default:
      res.setHeader('Allow', ['POST'])
      res.status(405).json({ data: null, error: { message: `Method ${method} Not Allowed` } })
  }
}

/**
 * The id in the path as `TEMPLATE_IDS` spells it, or `undefined` for anything else.
 *
 * The client sends lower kebab case: `ResetTemplateDialog.tsx` passes the id through
 * `getAuthTemplateType`, which is `id.toLowerCase().replace(/_/g, '-')`, so `MAGIC_LINK` arrives as
 * `magic-link`. Case and separator are both normalised, so the snake-cased spelling the sibling
 * `content` route takes is accepted here too rather than 404ing for no reason a caller could see.
 */
function templateIdOf(raw: string | string[] | undefined): TemplateId | undefined {
  if (typeof raw !== 'string') return undefined

  const id = raw.toUpperCase().replaceAll('-', '_')
  return (TEMPLATE_IDS as readonly string[]).includes(id) ? (id as TemplateId) : undefined
}

/**
 * Drops the subject and body the UI saved for one template, putting GoTrue back on its built-in
 * one, and answers with the config as it now stands — the client writes that straight into its
 * auth-config cache.
 */
const handlePost = async (req: NextApiRequest, res: NextApiResponse) => {
  const id = templateIdOf(req.query.template)
  if (id === undefined) {
    return res.status(404).json({ error: { message: 'Unknown template' } })
  }

  return res.status(200).json(await resetTemplate(id))
}
