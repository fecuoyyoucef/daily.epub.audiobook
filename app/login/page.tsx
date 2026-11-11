import Link from 'next/link'
import { redirect } from 'next/navigation'
import { BookOpen, ShieldCheck } from 'lucide-react'
import { LoginForm } from '@/components/auth/login-form'
import { getCurrentOwner, isOwnerSetupAvailable } from '@/lib/auth/owner'

export const dynamic = 'force-dynamic'

type LoginPageProps = {
  searchParams: Promise<{ setup?: string }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const owner = await getCurrentOwner()
  if (owner) redirect('/')

  const [{ setup }, setupAvailable] = await Promise.all([
    searchParams,
    isOwnerSetupAvailable(),
  ])

  return (
    <main className="auth-shell" dir="rtl">
      <section className="auth-card" aria-labelledby="login-title">
        <div className="auth-brand">
          <span className="auth-mark"><BookOpen size={22} aria-hidden="true" /></span>
          <div>
            <p className="auth-kicker">قارئ الكتب الصوتي</p>
            <p className="auth-brand-caption">مكتبتك، بصوتك</p>
          </div>
        </div>
        <div className="auth-heading">
          <h1 id="login-title">مرحباً بعودتك</h1>
          <p>سجّل الدخول لمتابعة القراءة والاستماع من حيث توقفت.</p>
        </div>
        {setup === 'complete' && <p className="auth-success" role="status">تم إعداد الحساب. يمكنك تسجيل الدخول الآن.</p>}
        <LoginForm />
        <div className="auth-private-note">
          <ShieldCheck size={17} aria-hidden="true" />
          <span>مساحة خاصة لحساب المالك فقط. لا يوجد تسجيل عام.</span>
        </div>
        {setupAvailable && (
          <p className="auth-setup-link"><Link href="/setup">إعداد حساب المالك لأول مرة</Link></p>
        )}
      </section>
    </main>
  )
}
