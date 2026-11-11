import { NextResponse } from 'next/server'
import { getOwnerForRequest, unauthorizedResponse } from '@/lib/auth/owner'
import { getReaderChapter } from '@/lib/db/repositories/library'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(request: Request, context: { params: Promise<{ bookId: string; chapterNumber: string }> }) {
  const owner = await getOwnerForRequest(request)
  if (!owner) return unauthorizedResponse()
  const { bookId, chapterNumber: chapterParam } = await context.params
  const chapterNumber = Number(chapterParam)
  if (!UUID_PATTERN.test(bookId) || !Number.isSafeInteger(chapterNumber) || chapterNumber < 1) {
    return NextResponse.json({ error: 'الفصل غير موجود.' }, { status: 404 })
  }

  const chapter = await getReaderChapter(owner.id, bookId, chapterNumber)
  if (!chapter) return NextResponse.json({ error: 'الفصل غير موجود.' }, { status: 404 })
  if (!chapter.text) return NextResponse.json({ error: 'محتوى الفصل غير متاح حالياً.' }, { status: 404 })
  return NextResponse.json(chapter, { headers: { 'Cache-Control': 'private, no-store' } })
}
