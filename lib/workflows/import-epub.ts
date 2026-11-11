import 'server-only'

import { createHash } from 'node:crypto'
import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import { FatalError } from 'workflow'
import { db } from '@/lib/db'
import { audioParts, audioProfiles, bookChapters, books, importJobs, jobEvents, uploads } from '@/lib/db/schema'
import { putPrivate, readPrivate } from '@/lib/store'
import { parseEpub, splitForTts } from '@/lib/epub'
import { GEMINI_TTS_MODEL } from '@/lib/tts'

const DEFAULT_AUDIO_SETTINGS = {
  enabled: true,
  startChapter: 1,
  endChapter: 1,
  dailyTarget: 10,
  model: GEMINI_TTS_MODEL,
  voice: 'Kore',
  language: 'ar-XA',
  style: 'Natural Arabic audiobook narration in clear Modern Standard Arabic. Read the supplied text verbatim, without summarizing, skipping, or adding commentary. Use measured pacing and restrained expressive delivery.',
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

async function processImportStep(jobId: string, userId: string) {
  'use step'

  const [job] = await db
    .select()
    .from(importJobs)
    .where(and(eq(importJobs.id, jobId), eq(importJobs.userId, userId)))
    .limit(1)
  if (!job?.bookId) throw new FatalError('The import job is not available.')
  if (job.status === 'completed') return { ok: true, bookId: job.bookId, status: 'completed' }
  if (job.status === 'cancelled' || job.status === 'failed') throw new FatalError('The import job is not active.')

  const [upload] = await db
    .select()
    .from(uploads)
    .where(and(eq(uploads.id, job.uploadId), eq(uploads.userId, userId)))
    .limit(1)
  if (!upload?.blobPath) throw new FatalError('The uploaded EPUB is not available.')

  await db
    .update(importJobs)
    .set({ status: 'running', stage: 'parsing', startedAt: job.startedAt ?? new Date(), updatedAt: new Date() })
    .where(and(eq(importJobs.id, jobId), eq(importJobs.userId, userId)))
  await db
    .update(books)
    .set({ status: 'parsing', updatedAt: new Date() })
    .where(and(eq(books.id, job.bookId), eq(books.userId, userId), isNull(books.deletedAt)))

  const epub = await readPrivate(upload.blobPath)
  if (!epub || epub.length !== Number(upload.sizeBytes) || sha256(epub) !== upload.sha256) {
    throw new FatalError('The uploaded EPUB could not be verified.')
  }

  let parsed: ReturnType<typeof parseEpub>
  try {
    parsed = parseEpub(epub)
  } catch {
    throw new FatalError('The uploaded file is not a supported EPUB.')
  }
  if (parsed.chapters.length > 2000) throw new FatalError('The EPUB contains too many chapters.')

  const chapterRows: (typeof bookChapters.$inferInsert)[] = []
  for (let index = 0; index < parsed.chapters.length; index += 1) {
    const chapter = parsed.chapters[index]
    const textHash = sha256(chapter.text)
    const textPath = `books/${userId}/${job.bookId}/chapters/${String(index + 1).padStart(4, '0')}.txt`
    await putPrivate(textPath, Buffer.from(chapter.text, 'utf8'), 'text/plain; charset=utf-8')
    chapterRows.push({
      userId,
      bookId: job.bookId,
      spineIndex: index,
      chapterNumber: index + 1,
      title: chapter.title.slice(0, 1000),
      language: /[\u0600-\u06ff]/u.test(chapter.text) ? 'ar' : 'und',
      direction: /[\u0600-\u06ff]/u.test(chapter.text) ? 'rtl' as const : 'auto' as const,
      textBlobPath: textPath,
      extractedText: null,
      textSha256: textHash,
      wordCount: chapter.text.trim().split(/\s+/u).filter(Boolean).length,
      characterCount: chapter.text.length,
      importStatus: 'ready' as const,
      updatedAt: new Date(),
    })
  }

  await db.transaction(async (transaction) => {
    for (let start = 0; start < chapterRows.length; start += 100) {
      const batch = chapterRows.slice(start, start + 100)
      await transaction
        .insert(bookChapters)
        .values(batch)
        .onConflictDoUpdate({
          target: [bookChapters.bookId, bookChapters.spineIndex],
          set: {
            chapterNumber: sql`excluded.chapter_number`,
            title: sql`excluded.title`,
            language: sql`excluded.language`,
            direction: sql`excluded.direction`,
            textBlobPath: sql`excluded.text_blob_path`,
            extractedText: sql`excluded.extracted_text`,
            textSha256: sql`excluded.text_sha256`,
            wordCount: sql`excluded.word_count`,
            characterCount: sql`excluded.character_count`,
            importStatus: sql`excluded.import_status`,
            updatedAt: sql`excluded.updated_at`,
          },
        })
    }

    const persistedChapters = await transaction
      .select({ id: bookChapters.id, spineIndex: bookChapters.spineIndex })
      .from(bookChapters)
      .where(and(eq(bookChapters.userId, userId), eq(bookChapters.bookId, job.bookId!)))
    const chapterIdBySpine = new Map(persistedChapters.map((chapter) => [chapter.spineIndex, chapter.id]))
    const audioPartRows: (typeof audioParts.$inferInsert)[] = []
    const styleHash = sha256(DEFAULT_AUDIO_SETTINGS.style)

    for (let chapterIndex = 0; chapterIndex < parsed.chapters.length; chapterIndex += 1) {
      const chapterId = chapterIdBySpine.get(chapterIndex)
      if (!chapterId) throw new Error('Imported chapter row is missing.')
      const pieces = splitForTts(parsed.chapters[chapterIndex].text)
      for (let partIndex = 0; partIndex < pieces.length; partIndex += 1) {
        audioPartRows.push({
          userId,
          bookId: job.bookId!,
          chapterId,
          partIndex: partIndex + 1,
          textSha256: sha256(pieces[partIndex]),
          model: DEFAULT_AUDIO_SETTINGS.model,
          voice: DEFAULT_AUDIO_SETTINGS.voice,
          language: DEFAULT_AUDIO_SETTINGS.language,
          styleHash,
          status: 'pending',
        })
      }
    }

    for (let start = 0; start < audioPartRows.length; start += 100) {
      await transaction.insert(audioParts).values(audioPartRows.slice(start, start + 100)).onConflictDoNothing()
    }

    const settings = { ...DEFAULT_AUDIO_SETTINGS, endChapter: parsed.chapters.length }
    const [existingProfile] = await transaction
      .select({ id: audioProfiles.id })
      .from(audioProfiles)
      .where(and(eq(audioProfiles.userId, userId), eq(audioProfiles.bookId, job.bookId!)))
      .limit(1)

    if (existingProfile) {
      await transaction
        .update(audioProfiles)
        .set({ settings, updatedAt: new Date() })
        .where(and(eq(audioProfiles.id, existingProfile.id), eq(audioProfiles.userId, userId)))
    } else {
      await transaction.insert(audioProfiles).values({ userId, bookId: job.bookId, settings })
    }

    await transaction
      .update(books)
      .set({ title: parsed.title.slice(0, 500), status: 'ready', updatedAt: new Date() })
      .where(and(eq(books.id, job.bookId!), eq(books.userId, userId)))

    if (upload.replaceExisting) {
      await transaction
        .update(books)
        .set({ status: 'archived', archivedAt: new Date(), updatedAt: new Date() })
        .where(and(
          eq(books.userId, userId),
          ne(books.id, job.bookId!),
          isNull(books.deletedAt),
          isNull(books.archivedAt),
        ))
    }

    await transaction
      .update(importJobs)
      .set({ status: 'completed', stage: 'completed', progressPercent: '100', finishedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(importJobs.id, jobId), eq(importJobs.userId, userId)))

    await transaction
      .update(uploads)
      .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(uploads.id, upload.id), eq(uploads.userId, userId)))

    await transaction.insert(jobEvents).values({
      userId,
      importJobId: jobId,
      eventType: 'import.completed',
      payload: { bookId: job.bookId, chapters: parsed.chapters.length },
    })
  })

  return { ok: true, bookId: job.bookId, chapters: parsed.chapters.length, status: 'completed' }
}

async function markImportFailedStep(jobId: string, userId: string) {
  'use step'

  const [job] = await db
    .select({ bookId: importJobs.bookId, uploadId: importJobs.uploadId })
    .from(importJobs)
    .where(and(eq(importJobs.id, jobId), eq(importJobs.userId, userId)))
    .limit(1)

  await db
    .update(importJobs)
    .set({ status: 'failed', stage: 'failed', lastErrorCode: 'IMPORT_FAILED', lastErrorMessageSafe: 'تعذّر تحليل الكتاب. تحقق من ملف EPUB وحاول مجدداً.', finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(importJobs.id, jobId), eq(importJobs.userId, userId)))

  if (job?.bookId) {
    await db
      .update(books)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(and(eq(books.id, job.bookId), eq(books.userId, userId)))
  }
  if (job?.uploadId) {
    await db
      .update(uploads)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(and(eq(uploads.id, job.uploadId), eq(uploads.userId, userId)))
  }
}

export async function importEpubWorkflow(jobId: string, userId: string) {
  'use workflow'

  try {
    return await processImportStep(jobId, userId)
  } catch (error) {
    await markImportFailedStep(jobId, userId)
    throw error
  }
}
