import { createFileRoute } from '@tanstack/react-router'

import { toWebHandler } from '@/compat/next/api'
import nextHandler from '@/pages/api/platform/storage/[ref]/credentials'

const handler = toWebHandler(nextHandler)

export const Route = createFileRoute('/api/platform/storage/$ref/credentials/')({
  server: { handlers: { GET: handler, POST: handler } },
})
