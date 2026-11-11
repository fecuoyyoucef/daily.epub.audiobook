import 'server-only'

import { createHmac } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

export function getRequestAddress(requestHeaders: Headers): string {
  const forwardedFor = requestHeaders.get('x-forwarded-for')
  return forwardedFor?.split(',').at(-1)?.trim().slice(0, 128) || 'unknown'
}

export async function allowAuthAttempt(
  identifier: string,
  maxAttempts: number,
  windowSeconds = 900,
): Promise<boolean> {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error('Authentication rate limiting is not configured.')

  const keyHash = createHmac('sha256', secret).update(identifier).digest('hex')
  const result = await db.execute(sql`
    INSERT INTO auth_rate_limits (key_hash, window_started_at, attempt_count, updated_at)
    VALUES (${keyHash}, now(), 1, now())
    ON CONFLICT (key_hash) DO UPDATE SET
      window_started_at = CASE
        WHEN auth_rate_limits.window_started_at <= now() - (${windowSeconds} * interval '1 second')
          THEN now()
        ELSE auth_rate_limits.window_started_at
      END,
      attempt_count = CASE
        WHEN auth_rate_limits.window_started_at <= now() - (${windowSeconds} * interval '1 second')
          THEN 1
        ELSE auth_rate_limits.attempt_count + 1
      END,
      updated_at = now()
    RETURNING attempt_count
  `)

  return Number(result.rows[0]?.attempt_count ?? 0) <= maxAttempts
}
