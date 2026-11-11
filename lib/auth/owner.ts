import 'server-only'

import { and, eq, isNull } from 'drizzle-orm'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { appUsers, authUser } from '@/lib/db/schema'

export type Owner = {
  id: string
  authUserId: string
  username: string
}

export async function getOwnerForHeaders(requestHeaders: Headers): Promise<Owner | null> {
  const session = await auth.api.getSession({ headers: requestHeaders })
  if (!session?.user) return null

  const [owner] = await db
    .select({
      id: appUsers.id,
      authUserId: appUsers.authUserId,
      username: appUsers.username,
    })
    .from(appUsers)
    .where(and(eq(appUsers.authUserId, session.user.id), isNull(appUsers.disabledAt)))
    .limit(1)

  return owner?.authUserId ? owner as Owner : null
}

export async function getOwnerForRequest(request: Request): Promise<Owner | null> {
  return getOwnerForHeaders(request.headers)
}

export async function getCurrentOwner(): Promise<Owner | null> {
  return getOwnerForHeaders(await headers())
}

export async function isOwnerSetupAvailable(): Promise<boolean> {
  const [existingOwner] = await db.select({ id: authUser.id }).from(authUser).limit(1)
  return !existingOwner
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return false

  try {
    return new URL(origin).origin === new URL(request.url).origin
  } catch {
    return false
  }
}

export function forbiddenOriginResponse(): Response {
  return Response.json(
    { error: 'forbidden_origin' },
    { status: 403, headers: { 'Cache-Control': 'no-store' } },
  )
}

export function unauthorizedResponse(): Response {
  return Response.json(
    { error: 'unauthorized' },
    { status: 401, headers: { 'Cache-Control': 'no-store' } },
  )
}
