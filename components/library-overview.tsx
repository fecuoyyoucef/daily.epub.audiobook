import Link from 'next/link'
import { AlertCircle, BookOpen, CheckCircle2, Headphones, LoaderCircle, RefreshCw, Settings, Sparkles } from 'lucide-react'
import type { LibraryBook } from './use-library-status'

type LibraryOverviewProps = {
  book: LibraryBook
  busy: boolean
  onRunNow: () => void
  onRetry: () => void
  onToggleAutomation: () => void
}

function StatCard({ icon: Icon, label, value, detail }: {
  icon: typeof BookOpen
  label: string
  value: string
  detail: string
}) {
  return (
    <div className="library-stat">
      <span className="library-stat-icon" aria-hidden="true"><Icon /></span>
      <div className="library-stat-copy">
        <span>{label}</span>
        <strong dir="ltr">{value}</strong>
        <small>{detail}</small>
      </div>
    </div>
  )
}

export function LibraryOverview({ book, busy, onRunNow, onRetry, onToggleAutomation }: LibraryOverviewProps) {
  const requestsUsed = book.dailyUsage.requestsUsed
  const requestsRemaining = Math.max(0, 10 - requestsUsed)
  const selectedProgress = book.selectedTotal
    ? Math.round(book.selectedCompleted / book.selectedTotal * 100)
    : 0
  const jobProgress = book.activeJob?.totalParts
    ? Math.round(book.activeJob.completedParts / book.activeJob.totalParts * 100)
    : 0
  const statusLabel = book.status !== 'ready'
    ? 'الكتاب قيد التجهيز'
    : book.enabled
      ? 'الجدولة مفعّلة'
      : 'الجدولة متوقفة'

  return (
    <section className="library-panel library-overview" aria-labelledby="current-book-title">
      <div className="library-panel-heading">
        <div className="library-book-heading">
          <span className="library-heading-icon" aria-hidden="true"><BookOpen /></span>
          <div className="library-book-heading-copy">
            <p className="library-overline">الكتاب الحالي</p>
            <h2 id="current-book-title">{book.title}</h2>
            <p className="library-muted library-filename">{book.filename}</p>
          </div>
        </div>
        <span className={`library-status-pill ${book.enabled ? 'is-positive' : 'is-neutral'}`}>
          <span className="library-status-dot" aria-hidden="true" />
          {statusLabel}
        </span>
      </div>

      <div className="library-stats-grid">
        <StatCard icon={CheckCircle2} label="فصول مكتملة" value={`${book.selectedCompleted} / ${book.selectedTotal}`} detail="ضمن النطاق المختار" />
        <StatCard icon={Sparkles} label="طلبات الصوت اليوم" value={`${requestsUsed} / 10`} detail={`متبقي ${requestsRemaining} طلبات`} />
        <StatCard icon={Settings} label="الهدف اليومي" value={`${book.settings.dailyTarget}`} detail="فصول في اليوم" />
      </div>

      <div className="library-range-progress">
        <div className="library-progress-label">
          <span>التقدم في النطاق</span>
          <strong>{selectedProgress}%</strong>
        </div>
        <div className="library-progress-track" role="progressbar" aria-label="التقدم في نطاق الفصول" aria-valuemin={0} aria-valuemax={100} aria-valuenow={selectedProgress}>
          <span style={{ width: `${selectedProgress}%` }} />
        </div>
        <p className="library-muted">الفصول {book.settings.startChapter}–{book.settings.endChapter} من أصل {book.total}</p>
      </div>

      {book.activeJob ? (
        <div className="library-job-state is-running" role="status" aria-live="polite">
          <div className="library-job-heading">
            <LoaderCircle className="library-spinner" aria-hidden="true" />
            <div>
              <strong>نعمل على تجهيز فصولك</strong>
              <p>{book.activeJob.completedParts} من {book.activeJob.totalParts} أجزاء اكتملت</p>
            </div>
            <span className="library-job-percent">{jobProgress}%</span>
          </div>
          <div className="library-progress-track is-compact" role="progressbar" aria-label="تقدم المهمة الصوتية" aria-valuemin={0} aria-valuemax={100} aria-valuenow={jobProgress}>
            <span style={{ width: `${jobProgress}%` }} />
          </div>
          <p className="library-muted">{book.activeJob.completedChapters} من {book.activeJob.totalChapters} فصول · {book.activeJob.requestsUsed + book.activeJob.requestsReserved} طلبات مستخدمة أو محجوزة</p>
        </div>
      ) : book.lastRun?.message ? (
        <div className={`library-job-state ${book.lastRun.status === 'completed' ? 'is-success' : 'is-warning'}`} role={book.lastRun.status === 'failed' ? 'alert' : 'status'}>
          <div className="library-job-heading">
            {book.lastRun.status === 'completed'
              ? <CheckCircle2 aria-hidden="true" />
              : <AlertCircle aria-hidden="true" />}
            <div>
              <strong>{book.lastRun.status === 'completed' ? 'اكتملت آخر دفعة' : 'تحتاج المهمة إلى متابعة'}</strong>
              <p>{book.lastRun.message}</p>
            </div>
          </div>
        </div>
      ) : book.next ? (
        <div className="library-next-chapter">
          <span className="library-overline">الفصل التالي</span>
          <strong>{book.next.number}. {book.next.title}</strong>
          <span>{book.next.partsCompleted}/{book.next.partsTotal} أجزاء جاهزة</span>
        </div>
      ) : null}

      {book.retryableParts > 0 && !book.activeJob && (
        <div className="library-retry-callout" role="note">
          <AlertCircle aria-hidden="true" />
          <div className="library-retry-copy">
            <strong>{book.retryableParts} جزء يحتاج إلى استئناف</strong>
            <p>سنبحث أولاً عن صوت محفوظ. إذا لم نجده، قد يستهلك كل جزء طلب TTS جديداً من حصة اليوم.</p>
          </div>
          <button className="library-button library-button-warm" type="button" onClick={onRetry} disabled={busy || requestsRemaining === 0}>
            <RefreshCw aria-hidden="true" />
            {requestsRemaining === 0 ? 'استأنف غداً' : 'استئناف وإعادة المحاولة'}
          </button>
        </div>
      )}

      <div className="library-actions">
        <button className="library-button library-button-primary" type="button" onClick={onRunNow} disabled={busy || Boolean(book.activeJob) || requestsRemaining === 0}>
          <Sparkles aria-hidden="true" />
          {book.activeJob ? 'المعالجة جارية' : requestsRemaining === 0 ? 'اكتملت حصة اليوم' : 'تشغيل الدفعة الآن'}
        </button>
        <button className="library-button library-button-secondary" type="button" onClick={onToggleAutomation} disabled={busy || book.status !== 'ready'}>
          <Settings aria-hidden="true" />
          {book.enabled ? 'إيقاف الجدولة' : 'استئناف الجدولة'}
        </button>
        <Link className="library-button library-button-quiet" href="/listen">
          <Headphones aria-hidden="true" />
          مشغل الصوت
        </Link>
      </div>
    </section>
  )
}
