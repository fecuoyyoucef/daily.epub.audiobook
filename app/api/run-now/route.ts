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
    const result = await queueAudioJob(owner.id, 'manual')
    return NextResponse.json({ ok: true, ...result }, { status: 'skipped' in result ? 200 : 202 })
  } catch (error) {
    if (error instanceof AudioJobError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status })
    }
    console.error('[audio] Could not queue manual job', error instanceof Error ? error.name : 'UnknownError')
    return NextResponse.json({ ok: false, error: 'تعذّر بدء مهمة الصوت.' }, { status: 500 })
  }
}
