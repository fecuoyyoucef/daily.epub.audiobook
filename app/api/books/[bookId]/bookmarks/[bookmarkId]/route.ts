import { NextResponse } from 'next/server'
import { forbiddenOriginResponse, getOwnerForRequest, isSameOriginRequest, unauthorizedResponse } from '@/lib/auth/owner'
import { removeReaderBookmark } from '@/lib/db/repositories/library'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function DELETE(request: Request, context: { params: Promise<{ bookId: string; bookmarkId: string }> }) {
  const owner = await getOwnerForRequest(request)
  if (!owner) return unauthorizedResponse()
  if (!isSameOriginRequest(request)) return forbiddenOriginResponse()
  const { bookId, bookmarkId } = await context.params
  if (!UUID_PATTERN.test(bookId) || !UUID_PATTERN.test(bookmarkId)) {
    return NextResponse.json({ error: 'الإشارة المرجعية غير موجودة.' }, { status: 404 })
  }
  const removed = await removeReaderBookmark(owner.id, bookId, bookmarkId)
  if (!removed) return NextResponse.json({ error: 'الإشارة المرجعية غير موجودة.' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
