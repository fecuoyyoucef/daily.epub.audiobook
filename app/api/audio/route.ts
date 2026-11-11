import { and, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { audioChapterAssets, bookChapters } from '@/lib/db/schema'
import { getActiveBook } from '@/lib/db/repositories/library'
import { getOwnerForRequest, unauthorizedResponse } from '@/lib/auth/owner'
import { readPrivate } from '@/lib/store'

export const runtime = 'nodejs'

function parseRange(header: string | null, size: number) {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!match) return false

  let start = match[1] === '' ? NaN : Number(match[1])
  let end = match[2] === '' ? NaN : Number(match[2])
  if (Number.isNaN(start)) {
    const suffixLength = end
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return false
    start = Math.max(size - suffixLength, 0)
    end = size - 1
  } else if (Number.isNaN(end)) {
    end = size - 1
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || end < start) return false
  return { start, end: Math.min(end, size - 1) }
}

export async function GET(request: NextRequest) {
  const owner = await getOwnerForRequest(request)
  if (!owner) return unauthorizedResponse()

  const chapterNumber = Number(request.nextUrl.searchParams.get('chapter'))
  if (!Number.isInteger(chapterNumber) || chapterNumber < 1 || chapterNumber > 2000) {
    return new Response('رقم فصل غير صالح.', { status: 400 })
  }

  try {
    const book = await getActiveBook(owner.id)
    if (!book) return new Response('لا يوجد كتاب في المكتبة.', { status: 404 })

    const [chapter] = await db
      .select({ id: bookChapters.id })
      .from(bookChapters)
      .where(and(
        eq(bookChapters.userId, owner.id),
        eq(bookChapters.bookId, book.id),
        eq(bookChapters.chapterNumber, chapterNumber),
      ))
      .limit(1)
    if (!chapter) return new Response('الفصل غير موجود.', { status: 404 })

    const [asset] = await db
      .select()
      .from(audioChapterAssets)
      .where(and(
        eq(audioChapterAssets.userId, owner.id),
        eq(audioChapterAssets.bookId, book.id),
        eq(audioChapterAssets.chapterId, chapter.id),
        eq(audioChapterAssets.status, 'ready'),
      ))
      .limit(1)
    if (!asset) return new Response('الصوت غير جاهز.', { status: 404 })

    const bytes = await readPrivate(asset.blobPath)
    if (!bytes || bytes.length !== Number(asset.sizeBytes)) {
      return new Response('الملف غير موجود.', { status: 404 })
    }

    const range = parseRange(request.headers.get('range'), bytes.length)
    if (range === false) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${bytes.length}`, 'Cache-Control': 'private, no-store' },
      })
    }

    const mimeType = /^audio\/[a-z0-9.+-]+$/i.test(asset.mimeType) ? asset.mimeType : 'audio/wav'
    const headers = new Headers({
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `inline; filename="chapter-${String(chapterNumber).padStart(4, '0')}.wav"`,
      'Content-Type': mimeType,
      'X-Content-Type-Options': 'nosniff',
    })

    if (range) {
      const body = bytes.subarray(range.start, range.end + 1)
      headers.set('Content-Length', String(body.length))
      headers.set('Content-Range', `bytes ${range.start}-${range.end}/${bytes.length}`)
      return new Response(new Uint8Array(body), { status: 206, headers })
    }

    headers.set('Content-Length', String(bytes.length))
    return new Response(new Uint8Array(bytes), { headers })
  } catch (error) {
    console.error('[audio] Private asset read failed', error instanceof Error ? error.name : 'UnknownError')
    return new Response('تعذّر تحميل الملف الصوتي.', { status: 500 })
  }
}
