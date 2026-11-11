import 'server-only'

import { createHash } from 'node:crypto'
import { and, asc, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm'
import { FatalError, sleep } from 'workflow'
import { db } from '@/lib/db'
import {
  audioChapterAssets,
  audioJobItems,
  audioJobs,
  audioParts,
  bookChapters,
  dailyUsage,
  jobEvents,
  quotaReservations,
} from '@/lib/db/schema'
import { estimateTokens, splitForTts } from '@/lib/epub'
import { putPrivate, readPrivate } from '@/lib/store'
import { generateArabicSpeech, TtsGenerationError } from '@/lib/tts'

const MAX_DAILY_REQUESTS = 10
const MAX_REQUESTS_PER_MINUTE = 3
const MAX_TOKENS_PER_MINUTE = 10_000
const MAX_PART_ATTEMPTS = 3
const TIME_ZONE = 'Africa/Algiers'

type AudioSettingsSnapshot = {
  model: string
  voice: string
  language: string
  style: string
}

function algeriaDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function settingsFromSnapshot(value: unknown): AudioSettingsSnapshot {
  const settings = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    model: typeof settings.model === 'string' ? settings.model : '',
    voice: typeof settings.voice === 'string' ? settings.voice : '',
    language: typeof settings.language === 'string' ? settings.language : '',
    style: typeof settings.style === 'string' ? settings.style : '',
  }
}

function pcmFromAudio(audio: Buffer): Buffer {
  if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') {
    return audio
  }

  let offset = 12
  let channels = 0
  let sampleRate = 0
  let bitDepth = 0
  let dataStart = -1
  let dataSize = 0

  while (offset + 8 <= audio.length) {
    const id = audio.toString('ascii', offset, offset + 4)
    const size = audio.readUInt32LE(offset + 4)
    const start = offset + 8
    if (start + size > audio.length) throw new Error('Invalid WAV chunk size.')
    if (id === 'fmt ' && size >= 16) {
      const format = audio.readUInt16LE(start)
      channels = audio.readUInt16LE(start + 2)
      sampleRate = audio.readUInt32LE(start + 4)
      bitDepth = audio.readUInt16LE(start + 14)
      if (format !== 1) throw new Error('Unsupported WAV encoding.')
    }
    if (id === 'data') {
      dataStart = start
      dataSize = size
      break
    }
    offset = start + size + (size % 2)
  }

  if (dataStart < 0 || channels !== 1 || sampleRate !== 24_000 || bitDepth !== 16) {
    throw new Error('Unsupported Gemini WAV format.')
  }
  return audio.subarray(dataStart, dataStart + dataSize)
}

function wavFromPcm(pcm: Buffer): Buffer {
  if (!pcm.length || pcm.length % 2 !== 0) throw new Error('Invalid PCM payload.')
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(24_000, 24)
  header.writeUInt32LE(48_000, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

async function getJobContextStep(jobId: string, userId: string) {
  'use step'

  const [job] = await db
    .select()
    .from(audioJobs)
    .where(and(eq(audioJobs.id, jobId), eq(audioJobs.userId, userId)))
    .limit(1)
  if (!job) throw new FatalError('The audio job is not available.')
  const items = await db
    .select({ id: audioJobItems.id, chapterId: audioJobItems.chapterId, sequence: audioJobItems.sequence })
    .from(audioJobItems)
    .where(and(eq(audioJobItems.jobId, jobId), eq(audioJobItems.userId, userId)))
    .orderBy(asc(audioJobItems.sequence))
  return {
    bookId: job.bookId,
    status: job.status,
    settings: settingsFromSnapshot(job.settingsSnapshot),
    items,
  }
}

async function markJobRunningStep(jobId: string, userId: string) {
  'use step'

  const [started] = await db
    .update(audioJobs)
    .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(audioJobs.id, jobId), eq(audioJobs.userId, userId), eq(audioJobs.status, 'queued')))
    .returning({ id: audioJobs.id })
  if (started) {
    await db.insert(jobEvents).values({ userId, audioJobId: jobId, eventType: 'audio.started', payload: {} })
  }
}

async function listPendingPartsStep(
  userId: string,
  bookId: string,
  chapterId: string,
  settings: AudioSettingsSnapshot,
) {
  'use step'

  const styleHash = sha256(settings.style)
  return db
    .select({ id: audioParts.id, status: audioParts.status, partIndex: audioParts.partIndex })
    .from(audioParts)
    .where(and(
      eq(audioParts.userId, userId),
      eq(audioParts.bookId, bookId),
      eq(audioParts.chapterId, chapterId),
      eq(audioParts.model, settings.model),
      eq(audioParts.voice, settings.voice),
      eq(audioParts.language, settings.language),
      eq(audioParts.styleHash, styleHash),
      inArray(audioParts.status, ['pending', 'failed']),
      lt(audioParts.attemptCount, MAX_PART_ATTEMPTS),
    ))
    .orderBy(asc(audioParts.partIndex))
}

async function getTextForPartStep(partId: string, userId: string) {
  'use step'

  const [part] = await db
    .select({
      partIndex: audioParts.partIndex,
      textSha256: audioParts.textSha256,
      chapterId: audioParts.chapterId,
    })
    .from(audioParts)
    .where(and(eq(audioParts.id, partId), eq(audioParts.userId, userId)))
    .limit(1)
  if (!part) return { ok: false as const, reason: 'part_missing' as const }

  const [chapter] = await db
    .select({ textBlobPath: bookChapters.textBlobPath })
    .from(bookChapters)
    .where(and(eq(bookChapters.id, part.chapterId), eq(bookChapters.userId, userId)))
    .limit(1)
  if (!chapter?.textBlobPath) return { ok: false as const, reason: 'text_missing' as const }

  const textBuffer = await readPrivate(chapter.textBlobPath)
  if (!textBuffer) return { ok: false as const, reason: 'text_missing' as const }
  const pieces = splitForTts(textBuffer.toString('utf8'))
  const text = pieces[part.partIndex - 1]
  if (!text || sha256(text) !== part.textSha256) return { ok: false as const, reason: 'text_changed' as const }

  const tokens = estimateTokens(text)
  if (tokens > 8192) return { ok: false as const, reason: 'part_too_long' as const }
  return { ok: true as const, text, tokens }
}

async function getPartStateStep(partId: string, userId: string) {
  'use step'

  const [part] = await db
    .select({ status: audioParts.status })
    .from(audioParts)
    .where(and(eq(audioParts.id, partId), eq(audioParts.userId, userId)))
    .limit(1)
  return part?.status ?? 'missing'
}

async function getReservedQuotaForPartStep(partId: string, userId: string) {
  'use step'

  const [reservation] = await db
    .select({ id: quotaReservations.id })
    .from(quotaReservations)
    .where(and(
      eq(quotaReservations.userId, userId),
      eq(quotaReservations.audioPartId, partId),
      eq(quotaReservations.status, 'reserved'),
    ))
    .orderBy(asc(quotaReservations.createdAt))
    .limit(1)
  return reservation?.id ?? null
}

async function markPartFailedWithoutRequestStep(partId: string, userId: string, reason: string) {
  'use step'

  await db
    .update(audioParts)
    .set({ status: 'failed' })
    .where(and(eq(audioParts.id, partId), eq(audioParts.userId, userId), inArray(audioParts.status, ['pending', 'failed'])))
  return reason
}

async function reserveQuotaStep(
  jobId: string,
  userId: string,
  partId: string,
  tokens: number,
  model: string,
) {
  'use step'

  const usageDate = algeriaDate()
  const now = new Date()
  const minuteAgo = new Date(now.getTime() - 60_000)

  return db.transaction(async (transaction) => {
    const [part] = await transaction
      .select({ attemptCount: audioParts.attemptCount, status: audioParts.status })
      .from(audioParts)
      .where(and(eq(audioParts.id, partId), eq(audioParts.userId, userId)))
      .for('update')
      .limit(1)
    if (!part) return { reason: 'part_unavailable' as const }
    if (part.status === 'reserved') {
      const [existingReservation] = await transaction
        .select({ id: quotaReservations.id, status: quotaReservations.status })
        .from(quotaReservations)
        .where(and(
          eq(quotaReservations.userId, userId),
          eq(quotaReservations.idempotencyKey, `tts:${partId}:${part.attemptCount}`),
        ))
        .limit(1)
      if (existingReservation?.status === 'reserved') {
        return { reservationId: existingReservation.id, reason: 'reserved' as const }
      }
      return { reason: 'part_unavailable' as const }
    }
    if (!['pending', 'failed'].includes(part.status) || part.attemptCount >= MAX_PART_ATTEMPTS) {
      return { reason: 'part_unavailable' as const }
    }

    await transaction
      .insert(dailyUsage)
      .values({ userId, model, usageDate, timezone: TIME_ZONE })
      .onConflictDoNothing()
    const [usage] = await transaction
      .select()
      .from(dailyUsage)
      .where(and(
        eq(dailyUsage.userId, userId),
        eq(dailyUsage.model, model),
        eq(dailyUsage.usageDate, usageDate),
        eq(dailyUsage.timezone, TIME_ZONE),
      ))
      .for('update')
      .limit(1)
    if (!usage) throw new Error('Daily usage row is unavailable.')

    if (usage.requestsReserved + usage.requestsCommitted >= MAX_DAILY_REQUESTS) {
      return { reason: 'daily_limit' as const }
    }

    const recent = await transaction
      .select({ createdAt: quotaReservations.createdAt, tokensReserved: quotaReservations.tokensReserved, tokensCommitted: quotaReservations.tokensCommitted })
      .from(quotaReservations)
      .where(and(
        eq(quotaReservations.userId, userId),
        eq(quotaReservations.model, model),
        gte(quotaReservations.createdAt, minuteAgo),
        inArray(quotaReservations.status, ['reserved', 'committed', 'uncertain']),
      ))
      .orderBy(asc(quotaReservations.createdAt))
    const tokensInWindow = recent.reduce((total, reservation) => total + Number(reservation.tokensReserved + reservation.tokensCommitted), 0)
    if (recent.length >= MAX_REQUESTS_PER_MINUTE || tokensInWindow + tokens > MAX_TOKENS_PER_MINUTE) {
      const waitMs = Math.max(1000, recent[0].createdAt.getTime() + 60_000 - now.getTime())
      return { waitMs, reason: 'rate_limit' as const }
    }

    const attempt = part.attemptCount + 1
    const idempotencyKey = `tts:${partId}:${attempt}`
    const [reservation] = await transaction
      .insert(quotaReservations)
      .values({
        userId,
        model,
        usageDate,
        timezone: TIME_ZONE,
        requestsReserved: 1,
        tokensReserved: BigInt(tokens),
        status: 'reserved',
        reason: 'audio_part',
        audioJobId: jobId,
        audioPartId: partId,
        idempotencyKey,
      })
      .onConflictDoNothing()
      .returning({ id: quotaReservations.id })

    if (!reservation) {
      return { reason: 'reservation_exists' as const }
    }

    await transaction
      .update(dailyUsage)
      .set({
        requestsReserved: sql`${dailyUsage.requestsReserved} + 1`,
        tokensReserved: sql`${dailyUsage.tokensReserved} + ${BigInt(tokens)}`,
        updatedAt: now,
      })
      .where(eq(dailyUsage.id, usage.id))
    await transaction
      .update(audioParts)
      .set({ status: 'reserved', attemptCount: attempt, lastAttemptAt: now })
      .where(and(eq(audioParts.id, partId), eq(audioParts.userId, userId)))
    await transaction
      .update(audioJobs)
      .set({ requestsReserved: sql`${audioJobs.requestsReserved} + 1`, updatedAt: now })
      .where(and(eq(audioJobs.id, jobId), eq(audioJobs.userId, userId)))

    return { reservationId: reservation.id, reason: 'reserved' as const }
  })
}

async function settleReservation(
  jobId: string,
  userId: string,
  partId: string,
  reservationId: string,
  outcome: 'committed' | 'uncertain' | 'released',
  partStatus: 'completed' | 'uncertain' | 'pending' | 'failed',
  audio?: { blobPath: string; sha256: string; sizeBytes: bigint; durationMs: bigint },
) {
  await db.transaction(async (transaction) => {
    const [reservation] = await transaction
      .select()
      .from(quotaReservations)
      .where(and(eq(quotaReservations.id, reservationId), eq(quotaReservations.userId, userId)))
      .for('update')
      .limit(1)
    if (!reservation || reservation.status !== 'reserved') return

    const [usage] = await transaction
      .select()
      .from(dailyUsage)
      .where(and(
        eq(dailyUsage.userId, userId),
        eq(dailyUsage.model, reservation.model),
        eq(dailyUsage.usageDate, reservation.usageDate),
        eq(dailyUsage.timezone, reservation.timezone),
      ))
      .for('update')
      .limit(1)
    if (!usage) throw new Error('Daily usage row is unavailable.')

    const released = outcome === 'released'
    await transaction
      .update(quotaReservations)
      .set({
        status: outcome,
        requestsReserved: 0,
        requestsCommitted: released ? 0 : 1,
        tokensReserved: 0n,
        tokensCommitted: released ? 0n : reservation.tokensReserved,
        updatedAt: new Date(),
      })
      .where(and(eq(quotaReservations.id, reservationId), eq(quotaReservations.userId, userId)))

    await transaction
      .update(dailyUsage)
      .set({
        requestsReserved: sql`GREATEST(${dailyUsage.requestsReserved} - 1, 0)`,
        requestsCommitted: released ? usage.requestsCommitted : sql`${dailyUsage.requestsCommitted} + 1`,
        tokensReserved: sql`GREATEST(${dailyUsage.tokensReserved} - ${reservation.tokensReserved}, 0)`,
        tokensCommitted: released ? usage.tokensCommitted : sql`${dailyUsage.tokensCommitted} + ${reservation.tokensReserved}`,
        updatedAt: new Date(),
      })
      .where(eq(dailyUsage.id, usage.id))

    await transaction
      .update(audioParts)
      .set({
        status: partStatus,
        ...(audio ? {
          audioBlobPath: audio.blobPath,
          audioSha256: audio.sha256,
          mimeType: 'audio/wav',
          sampleRate: 24_000,
          channels: 1,
          bitDepth: 16,
          sizeBytes: audio.sizeBytes,
          durationMs: audio.durationMs,
          completedAt: new Date(),
        } : {}),
      })
      .where(and(eq(audioParts.id, partId), eq(audioParts.userId, userId)))

    await transaction
      .update(audioJobs)
      .set({
        requestsReserved: sql`GREATEST(${audioJobs.requestsReserved} - 1, 0)`,
        ...(released ? {} : { requestsUsed: sql`${audioJobs.requestsUsed} + 1` }),
        ...(partStatus === 'completed' ? { completedParts: sql`${audioJobs.completedParts} + 1` } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(audioJobs.id, jobId), eq(audioJobs.userId, userId)))

    if (partStatus === 'completed') {
      const [part] = await transaction
        .select({ chapterId: audioParts.chapterId })
        .from(audioParts)
        .where(and(eq(audioParts.id, partId), eq(audioParts.userId, userId)))
        .limit(1)
      if (part) {
        await transaction
          .update(audioJobItems)
          .set({ completedParts: sql`${audioJobItems.completedParts} + 1`, status: 'running', updatedAt: new Date() })
          .where(and(eq(audioJobItems.jobId, jobId), eq(audioJobItems.userId, userId), eq(audioJobItems.chapterId, part.chapterId)))
      }
    }
  })
}

async function generateAudioPartStep(
  jobId: string,
  userId: string,
  partId: string,
  reservationId: string,
  text: string,
  settings: AudioSettingsSnapshot,
) {
  'use step'

  const [part] = await db
    .select({ status: audioParts.status, bookId: audioParts.bookId, chapterId: audioParts.chapterId, partIndex: audioParts.partIndex, textSha256: audioParts.textSha256, lastAttemptAt: audioParts.lastAttemptAt })
    .from(audioParts)
    .where(and(eq(audioParts.id, partId), eq(audioParts.userId, userId)))
    .limit(1)
  if (!part) return { status: 'failed' as const, reason: 'part_missing' }
  if (part.status === 'completed') return { status: 'completed' as const }
  if (part.status === 'uncertain') return { status: 'uncertain' as const, reason: 'provider_outcome_unknown' }

  const [chapter] = await db
    .select({ chapterNumber: bookChapters.chapterNumber })
    .from(bookChapters)
    .where(and(eq(bookChapters.id, part.chapterId), eq(bookChapters.userId, userId)))
    .limit(1)
  if (!chapter) {
    await settleReservation(jobId, userId, partId, reservationId, 'released', 'failed')
    return { status: 'failed' as const, reason: 'chapter_missing' }
  }

  const blobPath = `audio/${userId}/${part.bookId}/chapter-${String(chapter.chapterNumber).padStart(4, '0')}/part-${String(part.partIndex).padStart(3, '0')}-${part.textSha256.slice(0, 16)}.wav`
  if (part.status === 'generating') {
    const savedAudio = await readPrivate(blobPath)
    if (savedAudio) {
      const pcm = pcmFromAudio(savedAudio)
      const wav = wavFromPcm(pcm)
      await putPrivate(blobPath, wav, 'audio/wav')
      await settleReservation(jobId, userId, partId, reservationId, 'committed', 'completed', {
        blobPath,
        sha256: sha256(wav),
        sizeBytes: BigInt(wav.length),
        durationMs: BigInt(Math.round(pcm.length / 48)),
      })
      return { status: 'completed' as const }
    }
    if (part.lastAttemptAt && Date.now() - part.lastAttemptAt.getTime() > 300_000) {
      await settleReservation(jobId, userId, partId, reservationId, 'uncertain', 'uncertain')
      return { status: 'uncertain' as const, reason: 'provider_outcome_unknown' }
    }
    return { status: 'in_progress' as const }
  }
  if (part.status !== 'reserved') return { status: 'failed' as const, reason: 'part_not_reserved' }

  const [claimed] = await db
    .update(audioParts)
    .set({ status: 'generating' })
    .where(and(eq(audioParts.id, partId), eq(audioParts.userId, userId), eq(audioParts.status, 'reserved')))
    .returning({ id: audioParts.id })
  if (!claimed) return { status: 'in_progress' as const }

  try {
    const generated = await generateArabicSpeech(text)
    const pcm = pcmFromAudio(generated)
    const wav = wavFromPcm(pcm)
    await putPrivate(blobPath, wav, 'audio/wav')
    await settleReservation(jobId, userId, partId, reservationId, 'committed', 'completed', {
      blobPath,
      sha256: sha256(wav),
      sizeBytes: BigInt(wav.length),
      durationMs: BigInt(Math.round(pcm.length / 48)),
    })
    return { status: 'completed' as const }
  } catch (error) {
    if (error instanceof TtsGenerationError && error.kind === 'rate_limited') {
      await settleReservation(jobId, userId, partId, reservationId, 'released', 'pending')
      return { status: 'rate_limited' as const, retryAfterMs: error.retryAfterMs ?? 60_000 }
    }

    if (error instanceof TtsGenerationError && (error.kind === 'configuration' || error.kind === 'invalid_request')) {
      await settleReservation(jobId, userId, partId, reservationId, 'released', 'failed')
      return { status: 'failed' as const, reason: error.kind }
    }

    await settleReservation(jobId, userId, partId, reservationId, 'uncertain', 'uncertain')
    return { status: 'uncertain' as const, reason: 'provider_outcome_unknown' }
  }
}

async function markItemStatusStep(
  jobId: string,
  userId: string,
  chapterId: string,
  status: 'partial' | 'failed' | 'uncertain',
  message: string,
) {
  'use step'

  await db
    .update(audioJobItems)
    .set({ status, lastError: message, updatedAt: new Date() })
    .where(and(
      eq(audioJobItems.jobId, jobId),
      eq(audioJobItems.userId, userId),
      eq(audioJobItems.chapterId, chapterId),
      ne(audioJobItems.status, 'completed'),
    ))
}

async function assembleChapterStep(
  jobId: string,
  userId: string,
  bookId: string,
  chapterId: string,
  settings: AudioSettingsSnapshot,
) {
  'use step'

  const styleHash = sha256(settings.style)
  const [chapter] = await db
    .select({ chapterNumber: bookChapters.chapterNumber })
    .from(bookChapters)
    .where(and(eq(bookChapters.id, chapterId), eq(bookChapters.userId, userId), eq(bookChapters.bookId, bookId)))
    .limit(1)
  if (!chapter) return { ok: false as const, reason: 'chapter_missing' }

  const parts = await db
    .select({ partIndex: audioParts.partIndex, audioBlobPath: audioParts.audioBlobPath, status: audioParts.status })
    .from(audioParts)
    .where(and(
      eq(audioParts.userId, userId),
      eq(audioParts.bookId, bookId),
      eq(audioParts.chapterId, chapterId),
      eq(audioParts.model, settings.model),
      eq(audioParts.voice, settings.voice),
      eq(audioParts.language, settings.language),
      eq(audioParts.styleHash, styleHash),
    ))
    .orderBy(asc(audioParts.partIndex))

  if (!parts.length || parts.some((part, index) => part.status !== 'completed' || !part.audioBlobPath || part.partIndex !== index + 1)) {
    return { ok: false as const, reason: 'parts_incomplete' }
  }

  const pcmParts: Buffer[] = []
  let totalBytes = 0
  for (const part of parts) {
    const audio = await readPrivate(part.audioBlobPath!)
    if (!audio) return { ok: false as const, reason: 'part_audio_missing' }
    const pcm = pcmFromAudio(audio)
    totalBytes += pcm.length
    if (totalBytes > 512 * 1024 * 1024) return { ok: false as const, reason: 'chapter_audio_too_large' }
    pcmParts.push(pcm)
  }

  const wav = wavFromPcm(Buffer.concat(pcmParts))
  const assetPath = `audio/${userId}/${bookId}/chapter-${String(chapter.chapterNumber).padStart(4, '0')}/complete-${styleHash.slice(0, 16)}.wav`
  await putPrivate(assetPath, wav, 'audio/wav')
  const digest = sha256(wav)
  const durationMs = BigInt(Math.round(totalBytes / 48))

  await db.transaction(async (transaction) => {
    await transaction
      .insert(audioChapterAssets)
      .values({
        userId,
        bookId,
        chapterId,
        blobPath: assetPath,
        sha256: digest,
        mimeType: 'audio/wav',
        sampleRate: 24_000,
        channels: 1,
        bitDepth: 16,
        durationMs,
        sizeBytes: BigInt(wav.length),
        status: 'ready',
      })
      .onConflictDoUpdate({
        target: audioChapterAssets.chapterId,
        set: {
          blobPath: assetPath,
          sha256: digest,
          mimeType: 'audio/wav',
          sampleRate: 24_000,
          channels: 1,
          bitDepth: 16,
          durationMs,
          sizeBytes: BigInt(wav.length),
          status: 'ready',
          updatedAt: new Date(),
        },
      })

    const [completedItem] = await transaction
      .update(audioJobItems)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(and(
        eq(audioJobItems.jobId, jobId),
        eq(audioJobItems.userId, userId),
        eq(audioJobItems.chapterId, chapterId),
        ne(audioJobItems.status, 'completed'),
      ))
      .returning({ id: audioJobItems.id })
    if (completedItem) {
      await transaction
        .update(audioJobs)
        .set({ completedChapters: sql`${audioJobs.completedChapters} + 1`, updatedAt: new Date() })
        .where(and(eq(audioJobs.id, jobId), eq(audioJobs.userId, userId)))
      await transaction.insert(jobEvents).values({
        userId,
        audioJobId: jobId,
        eventType: 'audio.chapter_completed',
        payload: { chapterNumber: chapter.chapterNumber, parts: parts.length },
      })
    }
  })

  return { ok: true as const }
}

async function finishAudioJobStep(jobId: string, userId: string, stopReason: string | null) {
  'use step'

  const items = await db
    .select({ status: audioJobItems.status })
    .from(audioJobItems)
    .where(and(eq(audioJobItems.jobId, jobId), eq(audioJobItems.userId, userId)))
  const completed = items.filter((item) => item.status === 'completed').length
  const failed = items.some((item) => item.status === 'failed' || item.status === 'uncertain')
  const status = completed === items.length && items.length > 0
    ? 'completed'
    : failed && completed === 0
      ? 'failed'
      : 'partial'

  const [finishedJob] = await db
    .update(audioJobs)
    .set({
      status,
      lastErrorCode: stopReason ? 'AUDIO_JOB_INCOMPLETE' : null,
      lastErrorMessageSafe: stopReason,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(audioJobs.id, jobId),
      eq(audioJobs.userId, userId),
      inArray(audioJobs.status, ['queued', 'running']),
    ))
    .returning({ status: audioJobs.status })
  if (finishedJob) {
    await db.insert(jobEvents).values({
      userId,
      audioJobId: jobId,
      eventType: `audio.${status}`,
      payload: { completedChapters: completed, totalChapters: items.length, reason: stopReason },
    })
  }
  return { status: finishedJob?.status ?? status, completedChapters: completed, totalChapters: items.length }
}

export async function runAudioJobWorkflow(jobId: string, userId: string) {
  'use workflow'

  const context = await getJobContextStep(jobId, userId)
  if (['completed', 'partial', 'failed', 'cancelled', 'uncertain', 'paused'].includes(context.status)) {
    return { status: context.status }
  }
  await markJobRunningStep(jobId, userId)

  let stopReason: string | null = null

  for (const item of context.items) {
    const parts = await listPendingPartsStep(userId, context.bookId, item.chapterId, context.settings)
    let failed = false

    for (const part of parts) {
      const textResult = await getTextForPartStep(part.id, userId)
      if (!textResult.ok) {
        await markPartFailedWithoutRequestStep(part.id, userId, textResult.reason)
        await markItemStatusStep(jobId, userId, item.chapterId, 'failed', 'تعذّر التحقق من نص أحد أجزاء الفصل.')
        stopReason = 'تعذّر التحقق من نص أحد أجزاء الفصل.'
        failed = true
        break
      }

      let result: { status: string; reason?: string; retryAfterMs?: number } | null = null
      let rateRetries = 0

      while (!result || result.status === 'rate_limited') {
        const reservation = await reserveQuotaStep(jobId, userId, part.id, textResult.tokens, context.settings.model)
        if (reservation.reason === 'daily_limit') {
          stopReason = 'اكتمل الحد اليومي لطلبات الصوت؛ سيُستأنف العمل لاحقاً.'
          break
        }
        if (reservation.reason === 'rate_limit') {
          await sleep(`${Math.max(1, Math.ceil((reservation.waitMs ?? 1000) / 1000))}s`)
          continue
        }
        if (!reservation.reservationId) {
          result = { status: 'failed', reason: reservation.reason }
          break
        }

        result = await generateAudioPartStep(
          jobId,
          userId,
          part.id,
          reservation.reservationId,
          textResult.text,
          context.settings,
        )

        if (result?.status === 'rate_limited') {
          if (rateRetries < 2) {
            rateRetries += 1
            await sleep(`${Math.max(1, Math.ceil((result.retryAfterMs ?? 60_000) / 1000))}s`)
            result = null
          } else {
            result = { status: 'failed', reason: 'rate_limit_retry_exhausted' }
          }
        }

          if (result?.status === 'in_progress') {
          for (let attempt = 0; attempt < 60; attempt += 1) {
            await sleep('5s')
            const partState = await getPartStateStep(part.id, userId)
            if (partState === 'completed') {
              result = { status: 'completed' }
              break
            }
            if (partState === 'uncertain') {
              result = { status: 'uncertain', reason: 'provider_outcome_unknown' }
              break
            }
            if (partState === 'failed' || partState === 'pending') {
              result = { status: 'failed', reason: 'part_stopped' }
              break
            }
          }
        if (result?.status === 'in_progress') {
            const reservationId = await getReservedQuotaForPartStep(part.id, userId)
            result = reservationId
              ? await generateAudioPartStep(jobId, userId, part.id, reservationId, textResult.text, context.settings)
              : { status: 'uncertain', reason: 'reservation_missing' }
          }
        }
      }

      if (stopReason) {
        await markItemStatusStep(jobId, userId, item.chapterId, 'partial', stopReason)
        failed = true
        break
      }
      if (result?.status !== 'completed') {
        const status = result?.status === 'uncertain' ? 'uncertain' : 'failed'
        const message = status === 'uncertain'
          ? 'نتيجة الطلب غير مؤكدة؛ لم تتم إعادة المحاولة تلقائياً لتجنب التكرار.'
          : 'تعذّر توليد أحد الأجزاء الصوتية.'
        await markItemStatusStep(jobId, userId, item.chapterId, status, message)
        stopReason = message
        failed = true
        break
      }
    }

    if (failed) break
    const assembled = await assembleChapterStep(jobId, userId, context.bookId, item.chapterId, context.settings)
    if (!assembled.ok) {
      const message = 'تعذّر تجميع الصوت الكامل للفصل.'
      await markItemStatusStep(jobId, userId, item.chapterId, 'partial', message)
      stopReason = message
      break
    }
  }

  return finishAudioJobStep(jobId, userId, stopReason)
}
