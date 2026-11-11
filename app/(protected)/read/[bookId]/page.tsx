import { notFound } from 'next/navigation'
import { getCurrentOwner } from '@/lib/auth/owner'
import { getReaderBook, getReaderChapter } from '@/lib/db/repositories/library'
import ReaderClient from './reader-client'

export const dynamic = 'force-dynamic'

export default async function ReaderPage({ params }: { params: Promise<{ bookId: string }> }) {
  const owner = await getCurrentOwner()
  if (!owner) notFound()
  const { bookId } = await params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(bookId)) notFound()

  const book = await getReaderBook(owner.id, bookId)
  if (!book) notFound()
  const chapterNumber = book.currentChapterNumber ?? book.chapters[0]?.number
  const initialChapter = chapterNumber ? await getReaderChapter(owner.id, bookId, chapterNumber) : null

  return <ReaderClient book={book} initialChapter={initialChapter} initialProgress={book.progress} />
}
