'use client'

import { useActionState, useEffect, useRef } from 'react'
import { createFirstOwner, type BootstrapActionState } from '@/app/setup/actions'

const initialState: BootstrapActionState = { error: '' }

export function BootstrapForm() {
  const [state, formAction, pending] = useActionState(createFirstOwner, initialState)
  const secretRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (state.error && secretRef.current) secretRef.current.value = ''
  }, [state.error])

  return (
    <form className="auth-form" action={formAction}>
      <div>
        <label className="auth-label" htmlFor="setup-name">الاسم</label>
        <input className="auth-input" id="setup-name" name="name" autoComplete="name" maxLength={80} required />
      </div>
      <div>
        <label className="auth-label" htmlFor="setup-email">البريد الإلكتروني</label>
        <input
          className="auth-input"
          id="setup-email"
          name="email"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={254}
          dir="ltr"
          required
        />
      </div>
      <div>
        <label className="auth-label" htmlFor="setup-password">كلمة المرور</label>
        <input
          className="auth-input"
          id="setup-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          dir="ltr"
          required
        />
      </div>
      <div>
        <label className="auth-label" htmlFor="setup-confirm-password">تأكيد كلمة المرور</label>
        <input
          className="auth-input"
          id="setup-confirm-password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          dir="ltr"
          required
        />
      </div>
      <div>
        <label className="auth-label" htmlFor="bootstrap-secret">رمز الإعداد لمرة واحدة</label>
        <input
          ref={secretRef}
          className="auth-input"
          id="bootstrap-secret"
          name="bootstrapSecret"
          type="password"
          autoComplete="off"
          spellCheck={false}
          minLength={32}
          maxLength={512}
          dir="ltr"
          required
        />
      </div>
      {state.error && <p className="auth-error" role="alert">{state.error}</p>}
      <button className="auth-submit" type="submit" disabled={pending}>
        {pending ? 'جارٍ إنشاء الحساب...' : 'إنشاء حساب المالك'}
      </button>
    </form>
  )
}
