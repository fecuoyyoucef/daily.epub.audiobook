'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { BookOpen, Headphones, Settings, Sparkles } from 'lucide-react'
import { AudioResultsPanel } from './audio-results-panel'
import { EpubUploadPanel } from './epub-upload-panel'
import { LibraryOverview } from './library-overview'
import { useLibraryStatus, type LibraryStatus } from './use-library-status'

const MAX_FILE_BYTES = 15 * 1024 * 1024
const CHUNK_BYTES = 2 * 1024 * 1024
const RETRYABLE_UPLOAD_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

type PendingUpload = {
  file: File
  fileName: string
  fileSize: number
  lastModified: number
  totalParts: number
  idempotencyKey: string
  uploadId: string | null
  nextPartIndex: number
}

type UploadResponse = { error?: string; uploadId?: string; totalParts?: number }

class UploadRequestError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message)
    this.name = 'UploadRequestError'
  }
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function postWithRetry(url: string, init: RequestInit, onRetry: (attempt: number) => void): Promise<UploadResponse> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let response: Response
    try {
      response = await fetch(url, init)
    } catch {
      if (attempt === 3) throw new UploadRequestError('انقطع الاتصال بالخادم. أعد المحاولة للمتابعة دون إعادة الأجزاء المكتملة.')
      onRetry(attempt + 1)
      await wait(500 * 2 ** (attempt - 1))
      continue
    }

    const data = await response.json().catch(() => ({})) as UploadResponse
    if (response.ok) return data
    if (!RETRYABLE_UPLOAD_STATUSES.has(response.status) || attempt === 3) {
      throw new UploadRequestError(data.error || 'تعذّر إكمال طلب الرفع.', response.status)
    }
    onRetry(attempt + 1)
    await wait(500 * 2 ** (attempt - 1))
  }
  throw new UploadRequestError('تعذّر إكمال طلب الرفع.')
}

export function LibraryDashboard({ initialStatus }: { initialStatus: LibraryStatus }) {
  const { status, refresh } = useLibraryStatus(initialStatus)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('success')
  const [file, setFile] = useState<File | null>(null)
  const [rights, setRights] = useState(false)
  const [replace, setReplace] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null)

  const book = status.book
  const canResumeUpload = Boolean(file && pendingUpload?.file === file)

  function showMessage(text: string, tone: 'success' | 'error' = 'success') {
    setMessageTone(tone)
    setMessage(text)
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file || !rights) return
    if (file.size > MAX_FILE_BYTES) {
      showMessage('الحد الأقصى لحجم EPUB هو 15 MB.', 'error')
      return
    }

    const totalParts = Math.ceil(file.size / CHUNK_BYTES)
    let activeUpload: PendingUpload = canResumeUpload && pendingUpload
      ? pendingUpload
      : {
          file,
          fileName: file.name,
          fileSize: file.size,
          lastModified: file.lastModified,
          totalParts,
          idempotencyKey: crypto.randomUUID(),
          uploadId: null,
          nextPartIndex: 0,
        }

    setPendingUpload(activeUpload)
    setBusy(true)
    setUploadProgress(Math.round(activeUpload.nextPartIndex / totalParts * 85))
    showMessage(activeUpload.uploadId ? 'استئناف رفع الكتاب من آخر جزء محفوظ...' : 'يجري تجهيز رفع خاص وآمن...')

    try {
      if (!activeUpload.uploadId) {
        const initialized = await postWithRetry('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: file.name,
            fileSize: file.size,
            totalParts,
            rightsConfirmation: rights,
            replace,
            idempotencyKey: activeUpload.idempotencyKey,
          }),
        }, (attempt) => showMessage(`تعذر الاتصال. إعادة محاولة بدء الرفع ${attempt}/3...`))
        if (!initialized.uploadId) throw new UploadRequestError(initialized.error || 'تعذّر بدء الرفع.')
        activeUpload = { ...activeUpload, uploadId: initialized.uploadId }
        setPendingUpload(activeUpload)
      }

      const uploadId = activeUpload.uploadId
      if (!uploadId) throw new UploadRequestError('تعذّر استعادة جلسة الرفع.')
      for (let index = activeUpload.nextPartIndex; index < totalParts; index += 1) {
        const part = file.slice(index * CHUNK_BYTES, Math.min((index + 1) * CHUNK_BYTES, file.size))
        const form = new FormData()
        form.append('uploadId', uploadId)
        form.append('index', String(index))
        form.append('total', String(totalParts))
        form.append('chunk', part, `part-${index}.bin`)
        await postWithRetry('/api/upload/chunk', { method: 'POST', body: form }, (attempt) => {
          showMessage(`إعادة محاولة رفع الجزء ${index + 1} من ${totalParts} (${attempt}/3)...`)
        })
        activeUpload = { ...activeUpload, nextPartIndex: index + 1 }
        setPendingUpload(activeUpload)
        setUploadProgress(Math.round((index + 1) / totalParts * 85))
      }

      showMessage('اكتمل رفع الكتاب. يجري الآن استخراج الفصول في الخلفية...')
      await postWithRetry('/api/upload/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId }),
      }, (attempt) => showMessage(`إعادة محاولة بدء استخراج الكتاب (${attempt}/3)...`))

      setUploadProgress(100)
      showMessage('تم استلام الكتاب وبدء استخراجه. ستظهر الفصول تلقائياً عند جاهزيتها.')
      setPendingUpload(null)
      setFile(null)
      setRights(false)
      setReplace(false)
      const input = document.getElementById('epub-upload') as HTMLInputElement | null
      if (input) input.value = ''
      refresh()
    } catch (error) {
      const statusCode = error instanceof UploadRequestError ? error.status : undefined
      if (statusCode === 404) {
        setPendingUpload(null)
        showMessage('انتهت صلاحية جلسة الرفع. أعد المحاولة لبدء جلسة جديدة.', 'error')
      } else if (activeUpload.uploadId) {
        setPendingUpload(activeUpload)
        const detail = activeUpload.nextPartIndex < totalParts
          ? `يمكنك الاستئناف من الجزء ${activeUpload.nextPartIndex + 1} دون إعادة الأجزاء المكتملة.`
          : 'تم حفظ جميع الأجزاء. أعد المحاولة لإكمال الاستيراد دون رفع الملف من جديد.'
        showMessage(`${error instanceof Error ? error.message : 'حدث خطأ أثناء الرفع.'} ${detail}`, 'error')
      } else {
        showMessage(error instanceof Error ? error.message : 'حدث خطأ أثناء الرفع.', 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  async function runNow(retryUncertain = false) {
    setBusy(true)
    showMessage(retryUncertain ? 'يجري استئناف الأجزاء المتعثرة...' : 'يجري تشغيل الدفعة الصوتية...')
    try {
      const response = await fetch('/api/run-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retryUncertain }),
      })
      const result = await response.json()
      if (!response.ok || result.ok === false) throw new Error(result.error || 'تعذّر تشغيل الدفعة.')
      showMessage(result.skipped
        ? result.reason
        : result.status === 'already_running'
          ? 'توجد مهمة صوتية قيد التنفيذ بالفعل.'
          : retryUncertain
            ? 'بدأ استئناف الأجزاء. ستظهر النتيجة في هذه الصفحة تلقائياً.'
            : `بدأت مهمة صوتية لمعالجة ${result.chapters ?? 0} فصول.`)
      refresh()
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'حدث خطأ أثناء تشغيل الدفعة.', 'error')
      refresh()
    } finally {
      setBusy(false)
    }
  }

  async function toggleAutomation() {
    if (!book) return
    setBusy(true)
    try {
      const response = await fetch('/api/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !book.enabled }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'تعذّر تغيير إعداد الجدولة.')
      showMessage(book.enabled ? 'تم إيقاف الجدولة.' : 'تم استئناف الجدولة.')
      refresh()
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'تعذّر تغيير إعداد الجدولة.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="library-app">
      <div className="library-container">
        <header className="library-topbar">
          <Link href="/" className="library-brand" aria-label="مِداد، الصفحة الرئيسية">
            <span className="library-brand-mark" aria-hidden="true"><BookOpen /></span>
            <span className="library-brand-copy"><strong>مِداد</strong><small>مكتبتك الصوتية</small></span>
          </Link>
          <nav className="library-nav" aria-label="التنقل الرئيسي">
            <Link href="/" aria-current="page" aria-label="المكتبة"><BookOpen aria-hidden="true" /><span className="library-nav-label">المكتبة</span></Link>
            <Link href="/studio/manual" aria-label="استوديو الإنتاج"><Sparkles aria-hidden="true" /><span className="library-nav-label">الإنتاج</span></Link>
            <Link href="/listen" aria-label="مشغل الصوت"><Headphones aria-hidden="true" /><span className="library-nav-label">الاستماع</span></Link>
            <Link href="/settings" aria-label="الإعدادات"><Settings aria-hidden="true" /><span className="library-nav-label">الإعدادات</span></Link>
          </nav>
        </header>

        <section className="library-hero" aria-labelledby="library-title">
          <div>
            <p className="library-hero-kicker"><span aria-hidden="true" /> مساحة هادئة للقراءة والاستماع</p>
            <h1 id="library-title" className="library-title">كتبك، بصوتٍ يليق بها.</h1>
            <p className="library-hero-copy">تابع التحويل لحظة بلحظة، واستمع إلى كل فصل فور اكتماله.</p>
          </div>
          <span className="library-hero-mark" aria-hidden="true"><Headphones /></span>
        </section>

        {message && <div className={`library-banner ${messageTone === 'error' ? 'is-error' : 'is-success'}`} role={messageTone === 'error' ? 'alert' : 'status'} aria-live={messageTone === 'error' ? 'assertive' : 'polite'}>{message}</div>}

        {book ? (
          <>
            <LibraryOverview
              book={book}
              busy={busy}
              onRunNow={() => runNow(false)}
              onRetry={() => runNow(true)}
              onToggleAutomation={toggleAutomation}
            />
            <div className="library-content-grid">
              <AudioResultsPanel book={book} />
              <EpubUploadPanel
                busy={busy}
                file={file}
                rights={rights}
                replace={replace}
                hasBook
                uploadProgress={uploadProgress}
                canResumeUpload={canResumeUpload}
                onFileChange={setFile}
                onRightsChange={setRights}
                onReplaceChange={setReplace}
                onSubmit={upload}
              />
            </div>
          </>
        ) : (
          <section className="library-panel library-welcome">
            <div className="library-welcome-copy">
              <span className="library-heading-icon" aria-hidden="true"><BookOpen /></span>
              <p className="library-overline">ابدأ من هنا</p>
              <h2>أول كتاب لك يفتح رفّك الصوتي.</h2>
              <p className="library-muted">ارفع ملف EPUB، وسنستخرج فصوله لتقرأها أو تستمع إليها داخل مكتبتك الخاصة.</p>
            </div>
            <EpubUploadPanel
              busy={busy}
              file={file}
              rights={rights}
              replace={false}
              hasBook={false}
              uploadProgress={uploadProgress}
              canResumeUpload={canResumeUpload}
              onFileChange={setFile}
              onRightsChange={setRights}
              onReplaceChange={setReplace}
              onSubmit={upload}
            />
          </section>
        )}

        <footer className="library-footer">استخدم الكتب التي تملك حق تحويلها أو إذناً صريحاً بها. يحتفظ النظام بالأجزاء المكتملة لاستئناف العمل بأمان.</footer>
      </div>
    </main>
  )
}
