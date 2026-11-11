import { createHash, timingSafeEqual } from 'node:crypto'
import { and, eq, inArray, isNull, lt, or } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { appUsers, audioJobs, importJobs } from '@/lib/db/schema'
import { startAudioRun, queueAudioJob } from '@/lib/db/repositories/audio'
import { startImportRun } from '@/lib/uploads/service'

export const runtime = 'nodejs'
export const maxDuration = 60

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const provided = request.headers.get('authorization') ?? ''
  if (!secret) return false
  return timingSafeEqual(
    createHash('sha256').update(provided).digest(),
    createHash('sha256').update(`Bearer ${secret}`).digest(),
  )
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const [owner] = await db
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(isNull(appUsers.disabledAt))
      .limit(1)
    if (!owner) return NextResponse.json({ ok: true, skipped: true, reason: 'لا يوجد حساب نشط.' })

    const staleBefore = new Date(Date.now() - 120_000)
    const recoverableImports = await db
      .select({ id: importJobs.id })
      .from(importJobs)
      .where(and(
        eq(importJobs.userId, owner.id),
        inArray(importJobs.status, ['queued', 'running']),
        or(
          isNull(importJobs.workflowRunId),
          and(eq(importJobs.workflowRunId, 'starting'), lt(importJobs.updatedAt, staleBefore)),
        ),
      ))
      .limit(10)

    for (const job of recoverableImports) await startImportRun(owner.id, job.id)

    const recoverableAudioJobs = await db
      .select({ id: audioJobs.id })
      .from(audioJobs)
      .where(and(
        eq(audioJobs.userId, owner.id),
        inArray(audioJobs.status, ['queued', 'running']),
        or(
          isNull(audioJobs.workflowRunId),
          and(eq(audioJobs.workflowRunId, 'starting'), lt(audioJobs.updatedAt, staleBefore)),
        ),
      ))
      .limit(10)

    for (const job of recoverableAudioJobs) await startAudioRun(owner.id, job.id)

    const scheduled = await queueAudioJob(owner.id, 'automatic')
    return NextResponse.json({
      ok: true,
      resumedImports: recoverableImports.length,
      resumedAudioJobs: recoverableAudioJobs.length,
      scheduled,
    })
  } catch (error) {
    console.error('[cron] Scheduled job failed', error instanceof Error ? error.name : 'UnknownError')
    return NextResponse.json({ ok: false, error: 'تعذّر تشغيل المهام المجدولة.' }, { status: 500 })
  }
}
