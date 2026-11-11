'use server'

import { createHash, timingSafeEqual } from 'node:crypto'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { bootstrapAuth } from '@/lib/auth'
import { allowAuthAttempt, getRequestAddress } from '@/lib/auth/rate-limit'
import { isOwnerSetupAvailable } from '@/lib/auth/owner'

export type BootstrapActionState = { error: string }

function matchesSecret(candidate: string, expected: string): boolean {
  const candidateHash = createHash('sha256').update(candidate).digest()
  const expectedHash = createHash('sha256').update(expected).digest()
  return timingSafeEqual(candidateHash, expectedHash)
}

export async function createFirstOwner(
  _previousState: BootstrapActionState,
  formData: FormData,
): Promise<BootstrapActionState> {
  const requestHeaders = await headers()
  const address = getRequestAddress(requestHeaders)

  try {
    if (!(await allowAuthAttempt(`setup:ip:${address}`, 8, 3600))) {
      return { error: 'محاولات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.' }
    }

    const configuredSecret = process.env.APP_BOOTSTRAP_SECRET
    const providedSecret = String(formData.get('bootstrapSecret') ?? '')
    if (!configuredSecret || configuredSecret.length < 32 || !matchesSecret(providedSecret, configuredSecret)) {
      return { error: 'تعذّر إكمال الإعداد. راجع رمز الإعداد وحاول مرة أخرى.' }
    }

    if (!(await isOwnerSetupAvailable())) {
      return { error: 'إعداد الحساب الأول لم يعد متاحاً.' }
    }

    const name = String(formData.get('name') ?? '').trim()
    const email = String(formData.get('email') ?? '').trim().toLowerCase()
    const password = String(formData.get('password') ?? '')
    const confirmation = String(formData.get('confirmPassword') ?? '')

    if (!name || name.length > 80 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { error: 'أدخل اسماً وبريداً إلكترونياً صالحين.' }
    }
    if (password.length < 12 || password.length > 128) {
      return { error: 'استخدم كلمة مرور من 12 إلى 128 حرفاً على الأقل.' }
    }
    if (password !== confirmation) {
      return { error: 'كلمتا المرور غير متطابقتين.' }
    }

    await bootstrapAuth.api.signUpEmail({
      body: { name, email, password },
    })
  } catch (error) {
    console.error('[auth] First-owner setup failed', error instanceof Error ? error.name : 'UnknownError')
    return { error: 'تعذّر إنشاء الحساب. راجع البيانات وحاول مرة أخرى.' }
  }

  revalidatePath('/')
  redirect('/login?setup=complete')
}
