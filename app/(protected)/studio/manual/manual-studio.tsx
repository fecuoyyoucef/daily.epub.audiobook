'use client'

import Link from 'next/link'
import { useState } from 'react'

type Chapter = {
  number: number
  title: string
  status: string
  partsCompleted: number
  partsTotal: number
}

type LibraryStatus = {
  configured: boolean
  book: {
    title: string
    status: string
    chapters: Chapter[]
    activeJob: {
      status: string
      totalChapters: number
      completedChapters: number
      totalParts: number
      completedParts: number
      requestsUsed: number
      requestsReserved: number
    } | null
  } | null
}

function chapterStatus(status: string) {
  if (status === 'completed') return 'الصوت جاهز'
  if (status === 'processing') return 'قيد التجميع'
  if (status === 'error') return 'يحتاج مراجعة'
  if (status === 'pending') return 'بانتظار الإنتاج'
  return 'قيد الاستيراد'
}

export default function ManualStudio({ initialStatus }: { initialStatus: LibraryStatus }) {
  const [status, setStatus] = useState(initialStatus)
  const [selected, setSelected] = useState<number[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [message, setMessage] = useState('')
  const book = status.book
  const chapters = book?.chapters ?? []
  const selectable = chapters.filter((chapter) => chapter.status !== 'completed')

  function toggleChapter(number: number) {
    setSelected((current) => current.includes(number)
      ? current.filter((item) => item !== number)
      : [...current, number].sort((a, b) => a - b))
  }

  async function refreshStatus() {
    setRefreshing(true)
    try {
      const response = await fetch('/api/status', { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'تعذّر تحديث حالة المكتبة.')
      setStatus(result)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذّر تحديث الحالة.')
    } finally {
      setRefreshing(false)
    }
  }

  async function queueSelected() {
    if (!selected.length) return
    setSubmitting(true)
    setMessage('')
    try {
      const response = await fetch('/api/studio/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapterNumbers: selected }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'تعذّر بدء المهمة.')
      setMessage(result.skipped ? result.reason : result.status === 'already_running'
        ? 'توجد مهمة إنتاج جارية بالفعل.'
        : `أُضيفت ${result.chapters ?? selected.length} فصول إلى مهمة الإنتاج.`)
      setSelected([])
      await refreshStatus()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'حدث خطأ أثناء إضافة الفصول.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="wrap">
      <nav className="nav" aria-label="التنقل الرئيسي">
        <div className="brand">قارئ الكتب الصوتي</div>
        <div className="navlinks">
          <Link href="/">المكتبة</Link>
          <Link className="active" href="/studio/manual">استوديو الإنتاج</Link>
          <Link href="/listen">الاستماع</Link>
          <Link href="/settings">الإعدادات</Link>
        </div>
      </nav>

      <div className="eyebrow">MANUAL AUDIO STUDIO</div>
      <h1 className="title">استوديو الإنتاج اليدوي</h1>
      <p className="sub">اختر الفصول التي تريد تحويلها. تُحفظ كل قطعة مكتملة، ويستأنف النظام من الجزء المتبقي من دون تكرار الطلبات المحسومة.</p>

      {!status.configured && <div className="notice">توليد الصوت غير مهيأ في بيئة التشغيل الحالية.</div>}
      {message && <div className="notice ok" role="status" aria-live="polite">{message}</div>}

      <section className="card" aria-labelledby="studio-book-title">
        {!book ? <p className="muted">ارفع كتاب EPUB أولاً لتظهر فصوله هنا.</p> : <>
          <div className="row space">
            <div>
              <h2 id="studio-book-title">{book.title}</h2>
              <p className="muted">{chapters.length} فصول مستوردة</p>
            </div>
            <div className="row">
              <span className="pill">{book.activeJob ? 'مهمة قيد التنفيذ' : 'إنتاج عند الطلب'}</span>
              <button className="btn ghost" type="button" onClick={refreshStatus} disabled={refreshing}>
                {refreshing ? 'جارٍ التحديث...' : 'تحديث الحالة'}
              </button>
            </div>
          </div>

          {book.activeJob && <p className="small" role="status" aria-live="polite">
            التقدم الحالي: {book.activeJob.completedChapters}/{book.activeJob.totalChapters} فصول، {book.activeJob.completedParts}/{book.activeJob.totalParts} أجزاء، {book.activeJob.requestsUsed + book.activeJob.requestsReserved} طلبات مستخدمة أو محجوزة.
          </p>}

          <div className="row" style={{ margin: '14px 0' }}>
            <button className="btn secondary" type="button" onClick={() => setSelected(selectable.slice(0, 50).map((chapter) => chapter.number))} disabled={!selectable.length}>
              تحديد الفصول غير المكتملة
            </button>
            <button className="btn ghost" type="button" onClick={() => setSelected([])} disabled={!selected.length}>
              مسح التحديد
            </button>
            <span className="small">المحدد: {selected.length} من 50 كحد أقصى</span>
          </div>

          {!chapters.length ? <p className="muted">يجري استخراج الفصول؛ ستظهر هنا عند اكتمال الاستيراد.</p> : <div className="list" role="group" aria-label="فصول الكتاب">
            {chapters.map((chapter) => (
              <label className="chapter" key={chapter.number}>
                <span>
                  <strong>{chapter.number}. {chapter.title}</strong>
                  <span className="tag" style={{ display: 'block', marginTop: 5 }}>
                    {chapterStatus(chapter.status)} · {chapter.partsCompleted}/{chapter.partsTotal} أجزاء
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={selected.includes(chapter.number)}
                  onChange={() => toggleChapter(chapter.number)}
                  disabled={chapter.status === 'completed' || (!selected.includes(chapter.number) && selected.length >= 50)}
                  aria-label={`اختيار الفصل ${chapter.number}: ${chapter.title}`}
                />
              </label>
            ))}
          </div>}

          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn" type="button" onClick={queueSelected} disabled={submitting || !selected.length || !status.configured || !!book.activeJob}>
              {submitting ? 'جارٍ إنشاء المهمة...' : `إضافة ${selected.length || ''} إلى قائمة الإنتاج`}
            </button>
            <span className="small">تُطبق الحصة اليومية المشتركة البالغة 10 طلبات على الإنتاج اليدوي والآلي.</span>
          </div>
        </>}
      </section>
    </main>
  )
}
