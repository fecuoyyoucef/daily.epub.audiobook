const DEFAULT_PREVIEW_DATABASE_HOST = 'ep-steep-truth-bcm0xwwl.c-16.us-east-1.aws.neon.tech'

export type DatabaseEnvironment = Record<string, string | undefined>

export function resolveDatabaseUrl(env: DatabaseEnvironment = process.env): string {
  const isProduction = env.VERCEL_ENV === 'production'
  const connectionString = isProduction
    ? env.DATABASE_URL
    : env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL

  if (!connectionString) {
    throw new Error('DATABASE_URL is required to connect to Neon.')
  }

  if (isProduction) {
    return connectionString
  }

  const previewUrl = new URL(connectionString)
  previewUrl.hostname = env.NEON_PREVIEW_DATABASE_HOST ?? DEFAULT_PREVIEW_DATABASE_HOST
  previewUrl.searchParams.set('sslmode', 'verify-full')

  return previewUrl.toString()
}
