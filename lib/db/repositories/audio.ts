import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm'
import { start } from 'workflow/api'
import { db } from '@/lib/db'
import {
  audioChapterAssets,
  audioJobItems,
  audioJobs,
  audioParts,
  bookChapters,
  jobEvents,
} from '@/lib/db/schema'
import { getActiveBook, getAudioSettings } from '@/lib/db/repositories/library'
import { runAudioJobWorkflow } from '@/lib/workflows/audio'

const ACTIVE_JOB_STATUSES = ['queued', 'running', 'pause_requested'] as const
const MAX_PART_ATTEMPTS = 3

function styleHash(style: string): string {
  return createHash('sha256').update(style, 'utf8').digest('hex')
}

export class AudioJobError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = 'AudioJobError'
  }
}

export async function startAudioRun(userId: string, jobId: string): Promise<string | null> {
  const [job] = await db
    .select()
    .from(audioJobs)
    .where(and(eq(audioJobs.id, jobId), eq(audioJobs.userId, userId)))
    .limit(1)
  if (!job) throw new AudioJobError('مهمة الصوت غير موجودة.', 404)
  if (job.workflowRunId && job.workflowRunId !== 'starting') return job.workflowRunId
  if (job.workflowRunId === 'starting' && Date.now() - job.updatedAt.getTime() < 120_000) return null

  const staleBefore = new Date(Date.now() - 120_000)
  const [claimed] = await db
    .update(audioJobs)
    .set({ workflowRunId: 'starting', updatedAt: new Date() })
    .where(and(
      eq(audioJobs.id, jobId),
      eq(audioJobs.userId, userId),
      isNull(audioJobs.workflowRunId),
    ))
    .returning({ id: audioJobs.id })

  const [reclaimed] = claimed ? [] : await db
    .update(audioJobs)
    .set({ workflowRunId: 'starting', updatedAt: new Date() })
    .where(and(
      eq(audioJobs.id, jobId),
      eq(audioJobs.userId, userId),
      eq(audioJobs.workflowRunId, 'starting'),
      lt(audioJobs.updatedAt, staleBefore),
    ))
    .returning({ id: audioJobs.id })

  if (!claimed && !reclaimed) return null

  try {
    const run = await start(runAudioJobWorkflow, [jobId, userId])
    await db
      .update(audioJobs)
      .set({ workflowRunId: run.runId, updatedAt: new Date() })
      .where(and(eq(audioJobs.id, jobId), eq(audioJobs.userId, userId)))
    return run.runId
  } catch (error) {
    await db
      .update(audioJobs)
      .set({ workflowRunId: null, updatedAt: new Date() })
      .where(and(eq(audioJobs.id, jobId), eq(audioJobs.userId, userId), eq(audioJobs.workflowRunId, 'starting')))
    throw error
  }
}

export async function queueAudioJob(userId: string, mode: 'manual' | 'automatic', selectedChapterNumbers?: number[]) {
  const book = await getActiveBook(userId)
  if (!book) throw new AudioJobError('لا يوجد كتاب في المكتبة.', 404)
  if (book.status !== 'ready') throw new AudioJobError('لا يزال استيراد الكتاب قيد التنفيذ.', 409)
  if (mode === 'automatic' && !process.env.GEMINI_API_KEY) {
    throw new AudioJobError('توليد الصوت غير مهيأ.', 503)
  }

  const [activeJob] = await db
    .select({ id: audioJobs.id, workflowRunId: audioJobs.workflowRunId })
    .from(audioJobs)
    .where(and(
      eq(audioJobs.userId, userId),
      eq(audioJobs.bookId, book.id),
      inArray(audioJobs.status, [...ACTIVE_JOB_STATUSES]),
    ))
    .orderBy(desc(audioJobs.createdAt))
    .limit(1)

  if (activeJob) {
    const workflowRunId = await startAudioRun(userId, activeJob.id)
    return { jobId: activeJob.id, workflowRunId, status: 'already_running' as const }
  }

  if (!process.env.GEMINI_API_KEY) throw new AudioJobError('توليد الصوت غير مهيأ.', 503)

  const [lastChapter] = await db
    .select({ number: bookChapters.chapterNumber })
    .from(bookChapters)
    .where(and(eq(bookChapters.userId, userId), eq(bookChapters.bookId, book.id)))
    .orderBy(desc(bookChapters.chapterNumber))
    .limit(1)
  const totalChapters = Number(lastChapter?.number ?? 0)
  const settings = await getAudioSettings(userId, book.id, totalChapters)
  if (mode === 'automatic' && !settings.enabled) {
    return { skipped: true, reason: 'الجدولة متوقفة.' as const }
  }

  const normalizedSelection = selectedChapterNumbers === undefined
    ? undefined
    : [...new Set(selectedChapterNumbers)]
  if (normalizedSelection && (
    mode !== 'manual'
    || normalizedSelection.length < 1
    || normalizedSelection.length > 50
    || normalizedSelection.some((number) => !Number.isInteger(number) || number < 1 || number > totalChapters)
  )) {
    throw new AudioJobError('اختر من فصول الكتاب 1 إلى 50 برقم صالح.', 400)
  }

  const selectedFilter = normalizedSelection
    ? and(
      eq(bookChapters.userId, userId),
      eq(bookChapters.bookId, book.id),
      eq(bookChapters.importStatus, 'ready'),
      inArray(bookChapters.chapterNumber, normalizedSelection),
    )
    : and(
      eq(bookChapters.userId, userId),
      eq(bookChapters.bookId, book.id),
      eq(bookChapters.importStatus, 'ready'),
      gte(bookChapters.chapterNumber, settings.startChapter),
      lte(bookChapters.chapterNumber, settings.endChapter),
    )

  const selectedChapters = await db
    .select({ id: bookChapters.id, number: bookChapters.chapterNumber })
    .from(bookChapters)
    .where(selectedFilter)
    .orderBy(asc(bookChapters.chapterNumber))

  if (normalizedSelection && selectedChapters.length !== normalizedSelection.length) {
    throw new AudioJobError('تعذّر العثور على بعض الفصول المحددة أو أنها لم تكتمل بعد.', 400)
  }
  if (!selectedChapters.length) return { skipped: true, reason: 'لا توجد فصول جاهزة في النطاق المحدد.' as const }

  const chapterIds = selectedChapters.map((chapter) => chapter.id)
  const readyAssets = await db
    .select({ chapterId: audioChapterAssets.chapterId })
    .from(audioChapterAssets)
    .where(and(
      eq(audioChapterAssets.userId, userId),
      eq(audioChapterAssets.bookId, book.id),
      eq(audioChapterAssets.status, 'ready'),
      inArray(audioChapterAssets.chapterId, chapterIds),
    ))
  const readyChapterIds = new Set(readyAssets.map((asset) => asset.chapterId))
  const candidateChapterIds = chapterIds.filter((chapterId) => !readyChapterIds.has(chapterId))
  if (!candidateChapterIds.length) return { skipped: true, reason: 'اكتملت جميع فصول النطاق المحدد.' as const }

  const allParts = await db
    .select({ id: audioParts.id, chapterId: audioParts.chapterId, status: audioParts.status, attemptCount: audioParts.attemptCount })
    .from(audioParts)
    .where(and(
      eq(audioParts.userId, userId),
      eq(audioParts.bookId, book.id),
      eq(audioParts.model, settings.model),
      eq(audioParts.voice, settings.voice),
      eq(audioParts.language, settings.language),
      eq(audioParts.styleHash, styleHash(settings.style)),
      inArray(audioParts.chapterId, candidateChapterIds),
    ))

  const partCounts = new Map<string, { total: number; completed: number; processable: number }>()
  for (const part of allParts) {
    const counts = partCounts.get(part.chapterId) ?? { total: 0, completed: 0, processable: 0 }
    counts.total += 1
    if (part.status === 'completed') counts.completed += 1
    if ((part.status === 'pending' || part.status === 'failed') && part.attemptCount < MAX_PART_ATTEMPTS) counts.processable += 1
    partCounts.set(part.chapterId, counts)
  }
  const chaptersToProcess = selectedChapters
    .filter((chapter) => {
      const counts = partCounts.get(chapter.id)
      return counts && (counts.processable > 0 || counts.total > 0 && counts.completed === counts.total)
    })
    .slice(0, normalizedSelection?.length ?? settings.dailyTarget)
  if (!chaptersToProcess.length) {
    return { skipped: true, reason: 'لا توجد أجزاء صوتية قابلة للتشغيل الآن؛ راجع حالة الأجزاء غير المؤكدة.' as const }
  }

  const selectedIds = new Set(chaptersToProcess.map((chapter) => chapter.id))
  const selectedParts = allParts.filter((part) => selectedIds.has(part.chapterId)
    && (part.status === 'pending' || part.status === 'failed')
    && part.attemptCount < MAX_PART_ATTEMPTS)
  const totalParts = chaptersToProcess.reduce((total, chapter) => total + (partCounts.get(chapter.id)?.total ?? 0), 0)
  const completedParts = chaptersToProcess.reduce((total, chapter) => total + (partCounts.get(chapter.id)?.completed ?? 0), 0)
  const idempotencyKey = randomUUID()
  const created = await db.transaction(async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`)
    const [existing] = await transaction
      .select({ id: audioJobs.id })
      .from(audioJobs)
      .where(and(
        eq(audioJobs.userId, userId),
        eq(audioJobs.bookId, book.id),
        inArray(audioJobs.status, [...ACTIVE_JOB_STATUSES]),
      ))
      .limit(1)
    if (existing) return { id: existing.id, alreadyRunning: true }

    const [job] = await transaction
      .insert(audioJobs)
      .values({
        userId,
        bookId: book.id,
        mode,
        status: 'queued',
        priority: mode === 'manual' ? 1 : 0,
        requestedBy: mode === 'automatic' ? 'cron' : 'user',
        settingsSnapshot: { ...settings, timezone: 'Africa/Algiers' },
        totalChapters: chaptersToProcess.length,
        totalParts,
        completedParts,
        idempotencyKey,
      })
      .returning({ id: audioJobs.id })

    await transaction.insert(audioJobItems).values(chaptersToProcess.map((chapter, sequence) => ({
      userId,
      jobId: job.id,
      bookId: book.id,
      chapterId: chapter.id,
      sequence: sequence + 1,
      status: 'queued' as const,
      totalParts: partCounts.get(chapter.id)?.total ?? 0,
      completedParts: partCounts.get(chapter.id)?.completed ?? 0,
    })))
    await transaction.insert(jobEvents).values({
      userId,
      audioJobId: job.id,
      eventType: 'audio.queued',
      payload: { mode, chapters: chaptersToProcess.length, parts: selectedParts.length },
    })
    return { id: job.id, alreadyRunning: false }
  })

  const workflowRunId = await startAudioRun(userId, created.id)
  if (created.alreadyRunning) {
    return { jobId: created.id, workflowRunId, status: 'already_running' as const }
  }
  return { jobId: created.id, workflowRunId, status: 'queued' as const, chapters: chaptersToProcess.length, parts: selectedParts.length }
}
