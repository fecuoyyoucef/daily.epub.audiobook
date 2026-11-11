import 'server-only'

import { createHash } from 'node:crypto'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { bookmarks, readerPreferences, readerProgress } from '@/lib/db/schema'
import { GEMINI_TTS_MODEL } from '@/lib/tts'
import { readPrivate } from '@/lib/store'
import {
  audioChapterAssets,
  audioJobs,
  audioParts,
  audioProfiles,
  books,
  bookChapters,
  dailyUsage,
  uploads,
} from '@/lib/db/schema'

const DEFAULT_MODEL = GEMINI_TTS_MODEL
const DEFAULT_VOICE = 'Kore'
const DEFAULT_LANGUAGE = 'ar-XA'
const DEFAULT_STYLE = 'Natural Arabic audiobook narration in clear Modern Standard Arabic. Read the supplied text verbatim, without summarizing, skipping, or adding commentary. Use measured pacing and restrained expressive delivery.'
const APP_TIME_ZONE = 'Africa/Algiers'

export type AudioSettings = {
  enabled: boolean
  startChapter: number
  endChapter: number
  dailyTarget: number
  model: string
  voice: string
  language: string
  style: string
}

function algeriaDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function defaults(total: number): AudioSettings {
  return {
    enabled: true,
    startChapter: 1,
    endChapter: Math.max(total, 1),
    dailyTarget: 10,
    model: DEFAULT_MODEL,
    voice: DEFAULT_VOICE,
    language: DEFAULT_LANGUAGE,
    style: DEFAULT_STYLE,
  }
}

function normalizeSettings(value: Record<string, unknown> | null | undefined, total: number): AudioSettings {
  const fallback = defaults(total)
  const startChapter = Number(value?.startChapter ?? fallback.startChapter)
  const endChapter = Number(value?.endChapter ?? fallback.endChapter)
  const dailyTarget = Number(value?.dailyTarget ?? fallback.dailyTarget)

  return {
    enabled: typeof value?.enabled === 'boolean' ? value.enabled : fallback.enabled,
    startChapter: Number.isInteger(startChapter) && startChapter >= 1 && startChapter <= Math.max(total, 1)
      ? startChapter
      : fallback.startChapter,
    endChapter: Number.isInteger(endChapter) && endChapter >= 1 && endChapter <= Math.max(total, 1)
      ? endChapter
      : fallback.endChapter,
    dailyTarget: Number.isInteger(dailyTarget) && dailyTarget >= 1 && dailyTarget <= 10
      ? dailyTarget
      : fallback.dailyTarget,
    model: typeof value?.model === 'string' ? value.model : fallback.model,
    voice: typeof value?.voice === 'string' ? value.voice : fallback.voice,
    language: typeof value?.language === 'string' ? value.language : fallback.language,
    style: typeof value?.style === 'string' ? value.style : fallback.style,
  }
}

function styleFingerprint(style: string): string {
  return createHash('sha256').update(style, 'utf8').digest('hex')
}

export async function getActiveBook(userId: string) {
  const [book] = await db
    .select()
    .from(books)
    .where(and(eq(books.userId, userId), isNull(books.deletedAt), isNull(books.archivedAt)))
    .orderBy(desc(books.updatedAt))
    .limit(1)

  return book ?? null
}

export async function getAudioSettings(userId: string, bookId: string, total: number): Promise<AudioSettings> {
  const [profile] = await db
    .select({ settings: audioProfiles.settings })
    .from(audioProfiles)
    .where(and(eq(audioProfiles.userId, userId), eq(audioProfiles.bookId, bookId)))
    .limit(1)

  return normalizeSettings(profile?.settings, total)
}

export class LibrarySettingsError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = 'LibrarySettingsError'
  }
}

export async function updateAudioSettings(
  userId: string,
  updates: Partial<Pick<AudioSettings, 'enabled' | 'startChapter' | 'endChapter' | 'dailyTarget'>>,
) {
  const book = await getActiveBook(userId)
  if (!book) throw new LibrarySettingsError('لا يوجد كتاب في المكتبة.', 404)

  const [lastChapter] = await db
    .select({ number: bookChapters.chapterNumber })
    .from(bookChapters)
    .where(and(eq(bookChapters.userId, userId), eq(bookChapters.bookId, book.id)))
    .orderBy(desc(bookChapters.chapterNumber))
    .limit(1)
  const total = Number(lastChapter?.number ?? 0)

  if (updates.startChapter !== undefined || updates.endChapter !== undefined) {
    const current = await getAudioSettings(userId, book.id, total)
    const startChapter = updates.startChapter ?? current.startChapter
    const endChapter = updates.endChapter ?? current.endChapter
    if (!Number.isInteger(startChapter) || !Number.isInteger(endChapter) || startChapter < 1 || endChapter > total || startChapter > endChapter) {
      throw new LibrarySettingsError(`اختر نطاقاً صحيحاً بين 1 و${total}.`, 400)
    }
  }
  if (updates.dailyTarget !== undefined && (!Number.isInteger(updates.dailyTarget) || updates.dailyTarget < 1 || updates.dailyTarget > 10)) {
    throw new LibrarySettingsError('الهدف اليومي يجب أن يكون عدداً صحيحاً من 1 إلى 10 فصول.', 400)
  }

  const settings = await getAudioSettings(userId, book.id, total)
  if (updates.enabled !== undefined) settings.enabled = updates.enabled
  if (updates.startChapter !== undefined) settings.startChapter = updates.startChapter
  if (updates.endChapter !== undefined) settings.endChapter = updates.endChapter
  if (updates.dailyTarget !== undefined) settings.dailyTarget = updates.dailyTarget
  const [profile] = await db
    .select({ id: audioProfiles.id })
    .from(audioProfiles)
    .where(and(eq(audioProfiles.userId, userId), eq(audioProfiles.bookId, book.id)))
    .limit(1)

  if (profile) {
    await db
      .update(audioProfiles)
      .set({ settings, updatedAt: new Date() })
      .where(and(eq(audioProfiles.id, profile.id), eq(audioProfiles.userId, userId)))
  } else {
    await db.insert(audioProfiles).values({ userId, bookId: book.id, settings })
  }

  return settings
}

export async function getLibraryStatus(userId: string) {
  const book = await getActiveBook(userId)
  if (!book) return { configured: Boolean(process.env.GEMINI_API_KEY), book: null }

  const [chapterCountRow] = await db
    .select({ total: bookChapters.chapterNumber })
    .from(bookChapters)
    .where(and(eq(bookChapters.userId, userId), eq(bookChapters.bookId, book.id)))
    .orderBy(desc(bookChapters.chapterNumber))
    .limit(1)
  const total = Number(chapterCountRow?.total ?? 0)
  const settings = await getAudioSettings(userId, book.id, total)
  const today = algeriaDate()
  const currentStyleHash = styleFingerprint(settings.style)

  const [upload] = await db
    .select({ originalFilename: uploads.originalFilename })
    .from(uploads)
    .where(and(eq(uploads.userId, userId), eq(uploads.bookId, book.id)))
    .orderBy(desc(uploads.createdAt))
    .limit(1)

  const chapterRows = await db
    .select({
      id: bookChapters.id,
      number: bookChapters.chapterNumber,
      title: bookChapters.title,
      importStatus: bookChapters.importStatus,
      assetStatus: audioChapterAssets.status,
    })
    .from(bookChapters)
    .leftJoin(audioChapterAssets, and(
      eq(audioChapterAssets.chapterId, bookChapters.id),
      eq(audioChapterAssets.bookId, book.id),
      eq(audioChapterAssets.userId, userId),
      eq(audioChapterAssets.status, 'ready'),
    ))
    .where(and(eq(bookChapters.userId, userId), eq(bookChapters.bookId, book.id)))
    .orderBy(asc(bookChapters.chapterNumber))

  const partRows = await db
    .select({ chapterId: audioParts.chapterId, status: audioParts.status })
    .from(audioParts)
    .where(and(
      eq(audioParts.userId, userId),
      eq(audioParts.bookId, book.id),
      eq(audioParts.model, settings.model),
      eq(audioParts.voice, settings.voice),
      eq(audioParts.language, settings.language),
      eq(audioParts.styleHash, currentStyleHash),
    ))

  const partCounts = new Map<string, { total: number; completed: number; failed: number; uncertain: number }>()
  for (const part of partRows) {
    const current = partCounts.get(part.chapterId) ?? { total: 0, completed: 0, failed: 0, uncertain: 0 }
    current.total += 1
    if (part.status === 'completed') current.completed += 1
    if (part.status === 'failed') current.failed += 1
    if (part.status === 'uncertain') current.uncertain += 1
    partCounts.set(part.chapterId, current)
  }

  const chapters = chapterRows.map((chapter) => {
    const counts = partCounts.get(chapter.id) ?? { total: 0, completed: 0, failed: 0, uncertain: 0 }
    const status = chapter.assetStatus === 'ready'
      ? 'completed'
      : chapter.importStatus === 'ready'
        ? counts.failed + counts.uncertain > 0
          ? 'error'
          : counts.total > 0 && counts.completed === counts.total
            ? 'processing'
            : 'pending'
        : chapter.importStatus

    return {
      number: chapter.number,
      title: chapter.title,
      status,
      partsCompleted: counts.completed,
      partsTotal: counts.total,
      audioUrl: chapter.assetStatus === 'ready' ? `/api/audio?chapter=${chapter.number}` : null,
      error: status === 'error' ? 'توجد أجزاء لم تكتمل أو لم تُحسم نتيجتها.' : null,
    }
  })

  const selectedChapters = chapters.filter((chapter) => chapter.number >= settings.startChapter && chapter.number <= settings.endChapter)
  const completed = chapters.filter((chapter) => chapter.status === 'completed').length
  const selectedCompleted = selectedChapters.filter((chapter) => chapter.status === 'completed').length
  const [usage] = await db
    .select({ requestsReserved: dailyUsage.requestsReserved, requestsCommitted: dailyUsage.requestsCommitted })
    .from(dailyUsage)
    .where(and(
      eq(dailyUsage.userId, userId),
      eq(dailyUsage.model, settings.model),
      eq(dailyUsage.usageDate, today),
      eq(dailyUsage.timezone, APP_TIME_ZONE),
    ))
    .limit(1)

  const next = selectedChapters.find((chapter) => chapter.status !== 'completed')
  const [latestJob] = await db
    .select({
      id: audioJobs.id,
      status: audioJobs.status,
      totalChapters: audioJobs.totalChapters,
      completedChapters: audioJobs.completedChapters,
      totalParts: audioJobs.totalParts,
      completedParts: audioJobs.completedParts,
      requestsUsed: audioJobs.requestsUsed,
      requestsReserved: audioJobs.requestsReserved,
      message: audioJobs.lastErrorMessageSafe,
      createdAt: audioJobs.createdAt,
      finishedAt: audioJobs.finishedAt,
    })
    .from(audioJobs)
    .where(and(eq(audioJobs.userId, userId), eq(audioJobs.bookId, book.id)))
    .orderBy(desc(audioJobs.createdAt))
    .limit(1)
  const activeJob = latestJob && ['queued', 'running', 'pause_requested'].includes(latestJob.status)
    ? latestJob
    : null

  return {
    configured: Boolean(process.env.GEMINI_API_KEY),
    book: {
      id: book.id,
      title: book.title,
      filename: upload?.originalFilename ?? book.title,
      enabled: settings.enabled && book.status === 'ready',
      status: book.status,
      total,
      completed,
      progress: Math.round(completed / Math.max(total, 1) * 100),
      settings,
      selectedTotal: selectedChapters.length,
      selectedCompleted,
      dailyUsage: {
        date: today,
        requestsUsed: Number(usage?.requestsReserved ?? 0) + Number(usage?.requestsCommitted ?? 0),
        chaptersCompleted: completed,
      },
      lastRun: latestJob ? {
        date: latestJob.createdAt.toISOString(),
        status: latestJob.status,
        requestsUsed: latestJob.requestsUsed,
        chaptersCompleted: latestJob.completedChapters,
        message: latestJob.message,
        finishedAt: latestJob.finishedAt?.toISOString() ?? null,
      } : null,
      activeJob: activeJob ? {
        id: activeJob.id,
        status: activeJob.status,
        totalChapters: activeJob.totalChapters,
        completedChapters: activeJob.completedChapters,
        totalParts: activeJob.totalParts,
        completedParts: activeJob.completedParts,
        requestsUsed: activeJob.requestsUsed,
        requestsReserved: activeJob.requestsReserved,
      } : null,
      next: next ? {
        number: next.number,
        title: next.title,
        partsCompleted: next.partsCompleted,
        partsTotal: next.partsTotal,
      } : null,
      chapters,
    },
  }
}

export async function getReaderBook(userId: string, bookId: string) {
  const [book] = await db
    .select({ id: books.id, title: books.title, author: books.author, language: books.language, status: books.status })
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.userId, userId), isNull(books.deletedAt), isNull(books.archivedAt)))
    .limit(1)
  if (!book) return null

  const [chapters, progress, preferences, savedBookmarks] = await Promise.all([
    db
      .select({ id: bookChapters.id, number: bookChapters.chapterNumber, title: bookChapters.title, status: bookChapters.importStatus, wordCount: bookChapters.wordCount })
      .from(bookChapters)
      .where(and(eq(bookChapters.userId, userId), eq(bookChapters.bookId, bookId)))
      .orderBy(asc(bookChapters.chapterNumber)),
    db
      .select({ chapterId: readerProgress.chapterId, progressPercent: readerProgress.progressPercent, readingMode: readerProgress.readingMode })
      .from(readerProgress)
      .where(and(eq(readerProgress.userId, userId), eq(readerProgress.bookId, bookId)))
      .limit(1),
    db
      .select({ theme: readerPreferences.theme, fontFamily: readerPreferences.fontFamily, fontSize: readerPreferences.fontSize, lineHeight: readerPreferences.lineHeight, textAlignment: readerPreferences.textAlignment })
      .from(readerPreferences)
      .where(and(eq(readerPreferences.userId, userId), eq(readerPreferences.bookId, bookId)))
      .limit(1),
    db
      .select({ id: bookmarks.id, chapterId: bookmarks.chapterId, cfi: bookmarks.cfi, label: bookmarks.label, excerpt: bookmarks.excerpt, createdAt: bookmarks.createdAt })
      .from(bookmarks)
      .where(and(eq(bookmarks.userId, userId), eq(bookmarks.bookId, bookId)))
      .orderBy(desc(bookmarks.createdAt))
      .limit(100),
  ])

  const savedProgress = progress[0]
  const currentChapter = chapters.find((chapter) => chapter.id === savedProgress?.chapterId) ?? chapters[0] ?? null
  return {
    ...book,
    chapters,
    currentChapterNumber: currentChapter?.number ?? null,
    progress: savedProgress ? Number(savedProgress.progressPercent) : 0,
    readingMode: savedProgress?.readingMode ?? 'scroll',
    preferences: preferences[0] ? {
      ...preferences[0],
      fontSize: Number(preferences[0].fontSize),
      lineHeight: Number(preferences[0].lineHeight),
    } : null,
    bookmarks: savedBookmarks.map((bookmark) => ({
      ...bookmark,
      createdAt: bookmark.createdAt.toISOString(),
      chapterNumber: chapters.find((chapter) => chapter.id === bookmark.chapterId)?.number ?? null,
    })),
  }
}

export async function getReaderChapter(userId: string, bookId: string, chapterNumber: number) {
  const [chapter] = await db
    .select({ id: bookChapters.id, title: bookChapters.title, number: bookChapters.chapterNumber, textBlobPath: bookChapters.textBlobPath, extractedText: bookChapters.extractedText, status: bookChapters.importStatus, wordCount: bookChapters.wordCount })
    .from(bookChapters)
    .innerJoin(books, and(eq(books.id, bookChapters.bookId), eq(books.userId, bookChapters.userId)))
    .where(and(
      eq(bookChapters.userId, userId),
      eq(bookChapters.bookId, bookId),
      eq(bookChapters.chapterNumber, chapterNumber),
      isNull(books.deletedAt),
      isNull(books.archivedAt),
    ))
    .limit(1)
  if (!chapter) return null
  const text = chapter.extractedText ?? (chapter.textBlobPath ? (await readPrivate(chapter.textBlobPath))?.toString('utf8') ?? null : null)
  return { id: chapter.id, number: chapter.number, title: chapter.title, status: chapter.status, wordCount: chapter.wordCount, text }
}

export async function saveReaderProgress(userId: string, bookId: string, chapterNumber: number, progressPercent: number) {
  const [chapter] = await db
    .select({ id: bookChapters.id })
    .from(bookChapters)
    .innerJoin(books, and(eq(books.id, bookChapters.bookId), eq(books.userId, bookChapters.userId)))
    .where(and(
      eq(bookChapters.userId, userId),
      eq(bookChapters.bookId, bookId),
      eq(bookChapters.chapterNumber, chapterNumber),
      eq(bookChapters.importStatus, 'ready'),
      isNull(books.deletedAt),
      isNull(books.archivedAt),
    ))
    .limit(1)
  if (!chapter) return false
  const progress = Math.max(0, Math.min(100, progressPercent))
  await db.insert(readerProgress).values({
    userId,
    bookId,
    chapterId: chapter.id,
    cfi: `text:${progress.toFixed(2)}`,
    progressPercent: progress.toFixed(2),
    readingMode: 'scroll',
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [readerProgress.userId, readerProgress.bookId],
    set: {
      chapterId: chapter.id,
      cfi: `text:${progress.toFixed(2)}`,
      progressPercent: progress.toFixed(2),
      readingMode: 'scroll',
      updatedAt: new Date(),
    },
  })
  await db.update(books).set({ lastOpenedAt: new Date(), updatedAt: new Date() }).where(and(eq(books.id, bookId), eq(books.userId, userId)))
  return true
}

export async function addReaderBookmark(userId: string, bookId: string, chapterNumber: number, progressPercent: number, excerpt: string) {
  const [chapter] = await db
    .select({ id: bookChapters.id })
    .from(bookChapters)
    .innerJoin(books, and(eq(books.id, bookChapters.bookId), eq(books.userId, bookChapters.userId)))
    .where(and(
      eq(bookChapters.userId, userId),
      eq(bookChapters.bookId, bookId),
      eq(bookChapters.chapterNumber, chapterNumber),
      eq(bookChapters.importStatus, 'ready'),
      isNull(books.deletedAt),
      isNull(books.archivedAt),
    ))
    .limit(1)
  if (!chapter) return null
  const progress = Math.max(0, Math.min(100, progressPercent))
  const [bookmark] = await db.insert(bookmarks).values({
    userId,
    bookId,
    chapterId: chapter.id,
    cfi: `text:${progress.toFixed(2)}`,
    label: `موضع ${progress.toFixed(0)}٪`,
    excerpt: excerpt.slice(0, 500),
  }).returning({ id: bookmarks.id })
  return bookmark ?? null
}

export async function removeReaderBookmark(userId: string, bookId: string, bookmarkId: string) {
  const [removed] = await db.delete(bookmarks).where(and(
    eq(bookmarks.id, bookmarkId),
    eq(bookmarks.userId, userId),
    eq(bookmarks.bookId, bookId),
  )).returning({ id: bookmarks.id })
  return Boolean(removed)
}
