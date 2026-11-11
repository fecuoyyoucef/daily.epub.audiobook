import { NextResponse } from 'next/server'
import { forbiddenOriginResponse, getOwnerForRequest, isSameOriginRequest, unauthorizedResponse } from '@/lib/auth/owner'
import { addReaderBookmark } from '@/lib/db/repositories/library'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(request: Request, context: { params: Promise<{ bookId: string }> }) {
  const owner = await getOwnerForRequest(request)
  if (!owner) return unauthorizedResponse()
  if (!isSameOriginRequest(request)) return forbiddenOriginResponse()
  const { bookId } = await context.params
  if (!UUID_PATTERN.test(bookId)) return NextResponse.json({ error: 'الكتاب غير موجود.' }, { status: 404 })

  try {
    const body = await request.json()
    const chapterNumber = Number(body?.chapterNumber)
    const progressPercent = Number(body?.progressPercent)
    const excerpt = typeof body?.excerpt === 'string' ? body.excerpt.replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 500) : ''
    if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1 || !Number.isFinite(progressPercent) || progressPercent < 0 || progressPercent > 100) {
      return NextResponse.json({ error: 'موضع الإشارة المرجعية غير صالح.' }, { status: 400 })
    }
    const bookmark = await addReaderBookmark(owner.id, bookId, chapterNumber, progressPercent, excerpt)
    if (!bookmark) return NextResponse.json({ error: 'الفصل غير موجود.' }, { status: 404 })
    return NextResponse.json({ ok: true, bookmark }, { status: 201 })
  } catch (error) {
    console.error('[reader] Could not create bookmark', error instanceof Error ? error.name : 'UnknownError')
    return NextResponse.json({ error: 'تعذّر حفظ الإشارة المرجعية.' }, { status: 500 })
  }
}
