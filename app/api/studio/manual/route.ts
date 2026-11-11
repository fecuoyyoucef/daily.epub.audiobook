import { NextResponse } from 'next/server'
import { forbiddenOriginResponse, getOwnerForRequest, isSameOriginRequest, unauthorizedResponse } from '@/lib/auth/owner'
import { AudioJobError, queueAudioJob } from '@/lib/db/repositories/audio'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const owner = await getOwnerForRequest(request)
  if (!owner) return unauthorizedResponse()
  if (!isSameOriginRequest(request)) return forbiddenOriginResponse()

  try {
    const body = await request.json()
    const chapterNumbers = body && typeof body === 'object' && Array.isArray(body.chapterNumbers)
      ? body.chapterNumbers.map(Number)
      : null
    if (!chapterNumbers || chapterNumbers.some((number: number) => !Number.isInteger(number))) {
      return NextResponse.json({ error: 'قائمة الفصول غير صالحة.' }, { status: 400 })
    }

    const result = await queueAudioJob(owner.id, 'manual', chapterNumbers)
    return NextResponse.json({ ok: true, ...result }, { status: 'skipped' in result ? 200 : 202 })
  } catch (error) {
    if (error instanceof AudioJobError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[studio] Could not queue manual audio job', error instanceof Error ? error.name : 'UnknownError')
    return NextResponse.json({ error: 'تعذّر إضافة الفصول إلى قائمة الإنتاج.' }, { status: 500 })
  }
}
