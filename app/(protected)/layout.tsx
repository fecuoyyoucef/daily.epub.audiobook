import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { SignOutButton } from '@/components/auth/sign-out-button'
import { getCurrentOwner } from '@/lib/auth/owner'

export const dynamic = 'force-dynamic'

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const owner = await getCurrentOwner()
  if (!owner) redirect('/login')

  return (
    <>
      <div className="auth-sessionbar">
        <span>مساحة خاصة · تم تسجيل الدخول</span>
        <SignOutButton />
      </div>
      {children}
    </>
  )
}
