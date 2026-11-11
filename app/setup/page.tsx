import Link from 'next/link'
import { redirect } from 'next/navigation'
import { BookOpen, LockKeyhole } from 'lucide-react'
import { BootstrapForm } from '@/components/auth/bootstrap-form'
import { getCurrentOwner, isOwnerSetupAvailable } from '@/lib/auth/owner'

export const dynamic = 'force-dynamic'

export default async function SetupPage() {
  const [owner, setupAvailable] = await Promise.all([
    getCurrentOwner(),
    isOwnerSetupAvailable(),
  ])

  if (owner) redirect('/')
  if (!setupAvailable) redirect('/login')

  return (
    <main className="auth-shell" dir="rtl">
      <section className="auth-card" aria-labelledby="setup-title">
        <div className="auth-brand">
          <span className="auth-mark"><BookOpen size={22} aria-hidden="true" /></span>
          <div>
            <p className="auth-kicker">قارئ الكتب الصوتي</p>
            <p className="auth-brand-caption">إعداد آمن لمرة واحدة</p>
          </div>
        </div>
        <div className="auth-heading">
          <span className="auth-step-icon"><LockKeyhole size={18} aria-hidden="true" /></span>
          <h1 id="setup-title">إنشاء حساب المالك</h1>
          <p>هذه الخطوة متاحة قبل إنشاء الحساب الأول فقط. أدخل رمز الإعداد الذي حفظته في إعدادات المشروع.</p>
        </div>
        <BootstrapForm />
        <p className="auth-setup-link"><Link href="/login">العودة إلى تسجيل الدخول</Link></p>
      </section>
    </main>
  )
}
