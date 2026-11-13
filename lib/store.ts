import 'server-only'

import { createClient } from '@supabase/supabase-js'

export const MANIFEST_PATH = 'state/manifest.json'
export const PRIVATE_STORAGE_BUCKET = 'daily-epub-audiobook-private'

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Supabase Storage server credentials are not configured.')
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

const storage = supabase.storage.from(PRIVATE_STORAGE_BUCKET)

export async function putPrivate(pathname: string, body: string | Buffer | Uint8Array, contentType: string) {
  const uploadBody = typeof body === 'string' ? body : Buffer.isBuffer(body) ? body : Buffer.from(body)
  const { data, error } = await storage.upload(pathname, uploadBody, {
    cacheControl: '3600',
    contentType,
    upsert: true,
  })

  if (error) throw error
  return data
}

export async function putLock(pathname: string): Promise<void> {
  const { error } = await storage.upload(pathname, 'locked', {
    contentType: 'text/plain',
    upsert: false,
  })

  if (error) throw error
}

export async function readPrivate(pathname: string): Promise<Buffer | null> {
  const { data, error } = await storage.download(pathname)
  if (error) {
    if (error.statusCode === '404' || error.message.toLowerCase().includes('not found')) return null
    throw error
  }
  if (!data) return null
  return Buffer.from(await data.arrayBuffer())
}

export async function readJson<T>(pathname: string): Promise<T | null> {
  const data = await readPrivate(pathname)
  return data ? JSON.parse(data.toString('utf8')) as T : null
}

export async function writeJson(pathname: string, value: unknown): Promise<void> {
  await putPrivate(pathname, Buffer.from(JSON.stringify(value), 'utf8'), 'application/json')
}
