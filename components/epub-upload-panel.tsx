'use client'

import type { FormEvent } from 'react'
import { FileUp, ShieldCheck } from 'lucide-react'

type EpubUploadPanelProps = {
  busy: boolean
  file: File | null
  rights: boolean
  replace: boolean
  hasBook: boolean
  uploadProgress: number
  canResumeUpload: boolean
  onFileChange: (file: File | null) => void
  onRightsChange: (value: boolean) => void
  onReplaceChange: (value: boolean) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

export function EpubUploadPanel({
  busy,
  file,
  rights,
  replace,
  hasBook,
  uploadProgress,
  canResumeUpload,
  onFileChange,
  onRightsChange,
  onReplaceChange,
  onSubmit,
}: EpubUploadPanelProps) {
  return (
    <section className="library-panel library-upload" aria-labelledby="upload-title">
      <div className="library-section-heading">
        <div>
          <p className="library-overline">أضف إلى مكتبتك</p>
          <h2 id="upload-title">كتاب جديد</h2>
        </div>
        <span className="library-upload-icon" aria-hidden="true"><FileUp /></span>
      </div>
      <p className="library-muted">ارفع EPUB مرة واحدة. نقسمه بأمان ثم نجهّز الصوت في الخلفية.</p>

      <form className="library-upload-form" onSubmit={onSubmit}>
        <label className="library-field-label" htmlFor="epub-upload">ملف الكتاب · حتى 15 MB</label>
        <input
          id="epub-upload"
          className="library-file-input"
          type="file"
          accept=".epub,application/epub+zip"
          disabled={busy}
          onChange={(event) => onFileChange(event.currentTarget.files?.[0] ?? null)}
          aria-describedby="epub-upload-help"
        />
        <p id="epub-upload-help" className="library-field-help">EPUB فقط · الأجزاء المكتملة لا تُرفع من جديد عند الاستئناف.</p>
        {file && <p className="library-selected-file" role="status">تم اختيار: {file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB</p>}

        <label className="library-checkbox">
          <input type="checkbox" checked={rights} disabled={busy} onChange={(event) => onRightsChange(event.currentTarget.checked)} />
          <span>أؤكد أن لدي حق تحويل هذا النص إلى نسخة صوتية.</span>
        </label>
        {hasBook && (
          <label className="library-checkbox">
            <input type="checkbox" checked={replace} disabled={busy} onChange={(event) => onReplaceChange(event.currentTarget.checked)} />
            <span>أرشفة الكتاب الحالي وبدء مكتبة جديدة.</span>
          </label>
        )}

        {busy && uploadProgress > 0 && (
          <div className="library-upload-progress">
            <div className="library-progress-label"><span>تقدم الرفع</span><strong>{uploadProgress}%</strong></div>
            <div className="library-progress-track" role="progressbar" aria-label="تقدم رفع الكتاب" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress}>
              <span style={{ width: `${uploadProgress}%` }} />
            </div>
          </div>
        )}

        <button className="library-button library-button-primary library-upload-button" type="submit" disabled={busy || !file || !rights || hasBook && !replace}>
          <FileUp aria-hidden="true" />
          {busy ? 'جارٍ الرفع...' : canResumeUpload ? 'استئناف رفع الكتاب' : 'رفع الكتاب واستخراج فصوله'}
        </button>
      </form>

      <div className="library-private-note"><ShieldCheck aria-hidden="true" /><span>ملفاتك خاصة، ومفتاح توليد الصوت لا يصل إلى المتصفح.</span></div>
    </section>
  )
}
