import { NextResponse } from 'next/server'
import { forbiddenOriginResponse, getOwnerForRequest, isSameOriginRequest, unauthorizedResponse } from '@/lib/auth/owner'
import { saveReaderProgress } from '@/lib/db/repositories/library'

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
    if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1 || !Number.isFinite(progressPercent) || progressPercent < 0 || progressPercent > 100) {
      return NextResponse.json({ error: 'موضع القراءة غير صالح.' }, { status: 400 })
    }
    const saved = await saveReaderProgress(owner.id, bookId, chapterNumber, progressPercent)
    if (!saved) return NextResponse.json({ error: 'الفصل غير موجود.' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[reader] Could not save progress', error instanceof Error ? error.name : 'UnknownError')
    return NextResponse.json({ error: 'تعذّر حفظ موضع القراءة.' }, { status: 500 })
  }
}
