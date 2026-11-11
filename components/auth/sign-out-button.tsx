'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { authClient } from '@/lib/auth-client'

export function SignOutButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function signOut() {
    setBusy(true)
    const result = await authClient.signOut()
    setBusy(false)

    if (result.error) return
    router.replace('/login')
    router.refresh()
  }

  return (
    <button className="auth-signout" type="button" onClick={signOut} disabled={busy}>
      <LogOut size={15} aria-hidden="true" />
      <span>{busy ? 'جارٍ الخروج...' : 'تسجيل الخروج'}</span>
    </button>
  )
}
