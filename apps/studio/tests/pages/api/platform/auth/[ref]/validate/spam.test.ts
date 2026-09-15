import { components } from 'api-types'
import { createMocks } from 'node-mocks-http'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import handler from '../../../../../../../pages/api/platform/auth/[ref]/validate/spam'
import { mswServer } from '@/tests/lib/msw'

vi.mock('@/lib/constants', () => ({
  IS_PLATFORM: false,
  API_URL: 'https://api.example.com',
}))

describe('/api/platform/auth/[ref]/validate/spam', () => {
  beforeEach(() => {
    // The handler does not hit the network; disable MSW so unrelated unhandled-request errors don't fire.
    mswServer.close()
  })

  describe('Method handling', () => {
    it.each(['GET', 'PATCH', 'DELETE'] as const)('should return 405 for %s', async (method) => {
      const { req, res } = createMocks({ method, query: { ref: 'default' } })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(405)
      expect(JSON.parse(res._getData())).toEqual({
        data: null,
        error: { message: `Method ${method} Not Allowed` },
      })
      expect(res.getHeader('Allow')).toEqual(['POST'])
    })
  })

  describe('POST', () => {
    it('finds no spam, because self-hosted has nothing to score with', async () => {
      const body: components['schemas']['ValidateSpamBody'] = {
        subject: 'Confirm your signup',
        content: '<h1>Click here {{ .ConfirmationURL }}</h1>',
      }
      const { req, res } = createMocks({ method: 'POST', query: { ref: 'default' }, body })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(200)
      // The editor blocks a save on any rule scoring above zero, so an empty list is what lets a
      // template be saved at all.
      expect(JSON.parse(res._getData())).toEqual({ rules: [] })
    })

    it('refuses a body with no subject', async () => {
      const { req, res } = createMocks({
        method: 'POST',
        query: { ref: 'default' },
        body: { content: '<h1>hello</h1>' },
      })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(400)
      expect(JSON.parse(res._getData()).error.message).toBe(
        'subject and content must both be strings'
      )
    })

    it('refuses a body that is not an object', async () => {
      const { req, res } = createMocks({ method: 'POST', query: { ref: 'default' }, body: [] })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(400)
      expect(JSON.parse(res._getData()).error.message).toBe(
        'Body must be an object with a subject and content'
      )
    })
  })
})
