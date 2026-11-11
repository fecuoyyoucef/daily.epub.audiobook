'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import { authClient } from '@/lib/auth-client'

export function LoginForm() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setBusy(true)

    const formData = new FormData(event.currentTarget)
    const email = String(formData.get('email') ?? '').trim().toLowerCase()
    const password = String(formData.get('password') ?? '')

    try {
      const result = await authClient.signIn.email({ email, password, callbackURL: '/' })
      if (result.error) {
        setError(result.error.status === 429
          ? 'محاولات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.'
          : 'تعذّر تسجيل الدخول. راجع بياناتك وحاول مجدداً.')
        return
      }

      router.replace('/')
      router.refresh()
    } catch {
      setError('تعذّر الاتصال بالخدمة. حاول مرة أخرى بعد قليل.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <div>
        <label className="auth-label" htmlFor="login-email">البريد الإلكتروني</label>
        <input
          className="auth-input"
          id="login-email"
          name="email"
          type="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={254}
          dir="ltr"
        />
      </div>
      <div>
        <label className="auth-label" htmlFor="login-password">كلمة المرور</label>
        <div className="auth-password-field">
          <input
            className="auth-input"
            id="login-password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            maxLength={128}
            dir="ltr"
          />
          <button
            className="auth-password-toggle"
            type="button"
            aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
            aria-pressed={showPassword}
            onClick={() => setShowPassword((value) => !value)}
          >
            {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          </button>
        </div>
      </div>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="auth-submit" type="submit" disabled={busy}>
        {busy ? 'جارٍ التحقق...' : 'تسجيل الدخول'}
      </button>
    </form>
  )
}
