import { NextRequest, NextResponse } from 'next/server'
import { forbiddenOriginResponse, getOwnerForRequest, isSameOriginRequest, unauthorizedResponse } from '@/lib/auth/owner'
import { LibrarySettingsError, updateAudioSettings } from '@/lib/db/repositories/library'

export const runtime = 'nodejs'

export async function PATCH(request: NextRequest) {
  const owner = await getOwnerForRequest(request)
  if (!owner) return unauthorizedResponse()
  if (!isSameOriginRequest(request)) return forbiddenOriginResponse()

  try {
    const body = await request.json()
    const updates = {
      startChapter: body.startChapter === undefined ? undefined : Number(body.startChapter),
      endChapter: body.endChapter === undefined ? undefined : Number(body.endChapter),
      dailyTarget: body.dailyTarget === undefined ? undefined : Number(body.dailyTarget),
    }
    const settings = await updateAudioSettings(owner.id, updates)
    return NextResponse.json({ ok: true, settings })
  } catch (error) {
    if (error instanceof LibrarySettingsError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[settings] Settings update failed', error instanceof Error ? error.name : 'UnknownError')
    return NextResponse.json({ error: 'تعذّر حفظ الإعدادات.' }, { status: 500 })
  }
}
