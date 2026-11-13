import 'server-only'

import { and, eq, isNull } from 'drizzle-orm'
import { betterAuth } from 'better-auth'
import { db, pool } from '@/lib/db'
import { appUsers } from '@/lib/db/schema'

const baseURL =
  process.env.BETTER_AUTH_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : undefined) ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ??
  process.env.V0_RUNTIME_URL

const trustedOrigins = [
  ...(process.env.NODE_ENV === 'development'
    ? [
        'http://localhost:3000',
        // This exact v0 preview origin is the current workspace fallback when V0_BUILD_URL is absent.
        ...(!process.env.V0_RUNTIME_URL &&
        !process.env.V0_DEV_APP_URL &&
        !process.env.V0_BUILD_URL &&
        !process.env.V0_SANDBOX_URL
          ? ['https://workspace-phwnfchz.v0.build']
          : []),
        ...(process.env.V0_RUNTIME_URL ? [process.env.V0_RUNTIME_URL] : []),
        ...(process.env.V0_DEV_APP_URL ? [process.env.V0_DEV_APP_URL] : []),
        ...(process.env.V0_BUILD_URL ? [process.env.V0_BUILD_URL] : []),
        ...(process.env.V0_SANDBOX_URL ? [process.env.V0_SANDBOX_URL] : []),
      ]
    : []),
  ...(process.env.NODE_ENV === 'production'
    ? [
        ...(process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : []),
        ...(process.env.VERCEL_PROJECT_PRODUCTION_URL
          ? [`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`]
          : []),
      ]
    : []),
]

if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) {
  throw new Error('Better Auth requires a configured server secret of at least 32 characters.')
}

const sharedAuthOptions = {
  database: pool,
  baseURL,
  trustedOrigins,
  databaseHooks: {
    user: {
      create: {
        after: async (user: { id: string; email: string }) => {
          await db
            .insert(appUsers)
            .values({ authUserId: user.id, username: user.email.toLowerCase() })
            .onConflictDoNothing()
        },
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  ...(process.env.NODE_ENV === 'development'
    ? {
        advanced: {
          // The v0 preview is cross-site framed; these attributes preserve the login session there.
          defaultCookieAttributes: {
            sameSite: 'none' as const,
            secure: true,
          },
        },
      }
    : {}),
}

function createAuth(disableSignUp: boolean) {
  return betterAuth({
    ...sharedAuthOptions,
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      disableSignUp,
    },
  })
}

export const auth = createAuth(true)

// This instance is server-only and is never mounted as an HTTP handler.
export const bootstrapAuth = createAuth(false)
