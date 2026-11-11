import { toNextJsHandler } from 'better-auth/next-js'
import { auth } from '@/lib/auth'
import { allowAuthAttempt, getRequestAddress } from '@/lib/auth/rate-limit'

const authHandler = toNextJsHandler(auth)

export const GET = authHandler.GET

export async function POST(request: Request) {
  const pathname = new URL(request.url).pathname

  if (pathname.endsWith('/sign-up/email')) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  if (pathname.endsWith('/sign-in/email')) {
    try {
      const payload = await request.clone().json().catch(() => null)
      const email = typeof payload?.email === 'string'
        ? payload.email.trim().toLowerCase().slice(0, 254)
        : ''
      const address = getRequestAddress(request.headers)

      if (!(await allowAuthAttempt(`signin:ip:${address}`, 30))) {
        return Response.json(
          { error: 'too_many_attempts' },
          { status: 429, headers: { 'Retry-After': '900', 'Cache-Control': 'no-store' } },
        )
      }

      if (email && !(await allowAuthAttempt(`signin:email:${email}`, 8))) {
        return Response.json(
          { error: 'too_many_attempts' },
          { status: 429, headers: { 'Retry-After': '900', 'Cache-Control': 'no-store' } },
        )
      }
    } catch (error) {
      console.error('[auth] Sign-in throttling failed', error instanceof Error ? error.name : 'UnknownError')
      return Response.json(
        { error: 'temporarily_unavailable' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      )
    }
  }

  return authHandler.POST(request)
}
