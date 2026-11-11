import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { books } from '@/lib/db/schema'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function assertUuid(value: string, label: string): void {
  if (!uuidPattern.test(value)) {
    throw new TypeError(`${label} must be a valid UUID.`)
  }
}

export type CreateBookInput = {
  title: string
  author?: string | null
  publisher?: string | null
  language?: string
  description?: string | null
  epubBlobPath?: string | null
  epubSha256?: string | null
}

export async function listBooksForUser(userId: string) {
  assertUuid(userId, 'userId')

  return db
    .select()
    .from(books)
    .where(and(eq(books.userId, userId), isNull(books.deletedAt)))
    .orderBy(desc(books.updatedAt))
}

export async function findBookForUser(userId: string, bookId: string) {
  assertUuid(userId, 'userId')
  assertUuid(bookId, 'bookId')

  const [book] = await db
    .select()
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.userId, userId), isNull(books.deletedAt)))
    .limit(1)

  return book ?? null
}

export async function createBookForUser(userId: string, input: CreateBookInput) {
  assertUuid(userId, 'userId')
  const title = input.title.trim()

  if (!title || title.length > 500) {
    throw new TypeError('Book title must be between 1 and 500 characters.')
  }

  const [book] = await db
    .insert(books)
    .values({
      userId,
      title,
      author: input.author?.trim() || null,
      publisher: input.publisher?.trim() || null,
      language: input.language?.trim() || 'und',
      description: input.description?.trim() || null,
      epubBlobPath: input.epubBlobPath ?? null,
      epubSha256: input.epubSha256 ?? null,
      status: input.epubBlobPath ? 'uploading' : 'ready',
    })
    .returning()

  return book
}
