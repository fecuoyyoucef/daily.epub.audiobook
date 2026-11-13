import { NextResponse } from 'next/server'
import { forbiddenOriginResponse, getOwnerForRequest, isSameOriginRequest, unauthorizedResponse } from '@/lib/auth/owner'
import { AudioJobError, queueAudioJob } from '@/lib/db/repositories/audio'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request) {
  const owner = await getOwnerForRequest(request)
  if (!owner) return unauthorizedResponse()
  if (!isSameOriginRequest(request)) return forbiddenOriginResponse()

  try {
    const body = await request.json().catch(() => ({})) as { retryUncertain?: unknown } | null
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ ok: false, error: 'بيانات التشغيل غير صالحة.' }, { status: 400 })
    }
    if (body.retryUncertain !== undefined && typeof body.retryUncertain !== 'boolean') {
      return NextResponse.json({ ok: false, error: 'قيمة إعادة المحاولة غير صالحة.' }, { status: 400 })
    }
    const result = await queueAudioJob(owner.id, 'manual', undefined, { retryUncertain: body.retryUncertain === true })
    return NextResponse.json({ ok: true, ...result }, { status: 'skipped' in result ? 200 : 202 })
  } catch (error) {
    if (error instanceof AudioJobError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status })
    }
    console.error('[audio] Could not queue manual job', error instanceof Error ? error.name : 'UnknownError')
    return NextResponse.json({ ok: false, error: 'تعذّر بدء مهمة الصوت.' }, { status: 500 })
  }
}
