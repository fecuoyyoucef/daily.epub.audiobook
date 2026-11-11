import { NextResponse } from 'next/server'
import { getOwnerForRequest, unauthorizedResponse } from '@/lib/auth/owner'
import { getReaderBook } from '@/lib/db/repositories/library'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(request: Request, context: { params: Promise<{ bookId: string }> }) {
  const owner = await getOwnerForRequest(request)
  if (!owner) return unauthorizedResponse()
  const { bookId } = await context.params
  if (!UUID_PATTERN.test(bookId)) return NextResponse.json({ error: 'الكتاب غير موجود.' }, { status: 404 })

  const book = await getReaderBook(owner.id, bookId)
  if (!book) return NextResponse.json({ error: 'الكتاب غير موجود.' }, { status: 404 })
  return NextResponse.json(book, { headers: { 'Cache-Control': 'private, no-store' } })
}
