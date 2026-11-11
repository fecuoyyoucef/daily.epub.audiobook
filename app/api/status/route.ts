import { NextResponse } from 'next/server'
import { forbiddenOriginResponse, getOwnerForRequest, isSameOriginRequest, unauthorizedResponse } from '@/lib/auth/owner'
import { getLibraryStatus, LibrarySettingsError, updateAudioSettings } from '@/lib/db/repositories/library'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const owner = await getOwnerForRequest(request)
  if (!owner) return unauthorizedResponse()

  try {
    return NextResponse.json(await getLibraryStatus(owner.id), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[status] Database read failed', error instanceof Error ? error.name : 'UnknownError')
    return NextResponse.json({ error: 'تعذّر قراءة حالة المكتبة.' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const owner = await getOwnerForRequest(request)
  if (!owner) return unauthorizedResponse()
  if (!isSameOriginRequest(request)) return forbiddenOriginResponse()

  try {
    const body = await request.json()
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'قيمة الجدولة غير صالحة.' }, { status: 400 })
    }
    const settings = await updateAudioSettings(owner.id, { enabled: body.enabled })
    return NextResponse.json({ ok: true, enabled: settings.enabled })
  } catch (error) {
    if (error instanceof LibrarySettingsError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[status] Settings update failed', error instanceof Error ? error.name : 'UnknownError')
    return NextResponse.json({ error: 'تعذّر تحديث إعدادات الجدولة.' }, { status: 500 })
  }
}
