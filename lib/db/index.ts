import 'server-only'

import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'
import { resolveDatabaseUrl } from './database-url'

const globalForDatabase = globalThis as typeof globalThis & {
  neonPool?: Pool
}

export const pool = globalForDatabase.neonPool ?? new Pool({
  connectionString: resolveDatabaseUrl(),
  max: process.env.VERCEL ? 1 : 5,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
  allowExitOnIdle: true,
})

if (process.env.NODE_ENV !== 'production') {
  globalForDatabase.neonPool = pool
}

export const db = drizzle(pool, { schema })
