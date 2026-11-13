'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ArrowUpRight, BookOpen, Headphones, Search, Settings, Sparkles } from 'lucide-react'
import { useLibraryStatus, type LibraryStatus } from './use-library-status'

export function ListenLibrary({ initialStatus }: { initialStatus: LibraryStatus }) {
  const { status } = useLibraryStatus(initialStatus)
  const searchParams = useSearchParams()
  const requestedChapter = Number(searchParams.get('chapter')) || null
  const book = status.book
  const chapters = book?.chapters ?? []
  const [selected, setSelected] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'ready' | 'all' | 'pending'>('ready')

  useEffect(() => {
    if (!chapters.length) return
    setSelected((current) => {
      if (current && chapters.some((chapter) => chapter.number === current)) return current
      const requested = chapters.find((chapter) => chapter.number === requestedChapter && chapter.audioUrl)
      return requested?.number ?? chapters.find((chapter) => chapter.audioUrl)?.number ?? chapters[0].number
    })
  }, [book?.id, chapters, requestedChapter])

  const visible = useMemo(() => chapters.filter((chapter) => {
    const matchesQuery = `${chapter.number} ${chapter.title}`.toLowerCase().includes(query.toLowerCase())
    const matchesFilter = filter === 'all' || (filter === 'ready' ? Boolean(chapter.audioUrl) : !chapter.audioUrl)
    return matchesQuery && matchesFilter
  }), [chapters, filter, query])
  const current = chapters.find((chapter) => chapter.number === selected)
  const readyCount = chapters.filter((chapter) => chapter.audioUrl).length

  return (
    <main className="library-app">
      <div className="library-container">
        <header className="library-topbar">
          <Link href="/" className="library-brand" aria-label="مِداد، الصفحة الرئيسية">
            <span className="library-brand-mark" aria-hidden="true"><BookOpen /></span>
            <span className="library-brand-copy"><strong>مِداد</strong><small>مكتبتك الصوتية</small></span>
          </Link>
          <nav className="library-nav" aria-label="التنقل الرئيسي">
            <Link href="/" aria-label="المكتبة"><BookOpen aria-hidden="true" /><span className="library-nav-label">المكتبة</span></Link>
            <Link href="/studio/manual" aria-label="استوديو الإنتاج"><Sparkles aria-hidden="true" /><span className="library-nav-label">الإنتاج</span></Link>
            <Link href="/listen" aria-current="page" aria-label="مشغل الصوت"><Headphones aria-hidden="true" /><span className="library-nav-label">الاستماع</span></Link>
            <Link href="/settings" aria-label="الإعدادات"><Settings aria-hidden="true" /><span className="library-nav-label">الإعدادات</span></Link>
          </nav>
        </header>

        <section className="library-hero library-listen-hero" aria-labelledby="listen-title">
          <div>
            <p className="library-hero-kicker"><span aria-hidden="true" /> استمع من حيث توقفت</p>
            <h1 id="listen-title" className="library-title">رفّك الصوتي</h1>
            <p className="library-hero-copy">كل فصل يكتمل يظهر هنا مباشرة، مع مشغّل وتنزيل خاص.</p>
          </div>
          <span className="library-hero-mark" aria-hidden="true"><Headphones /></span>
        </section>

        {!book ? (
          <section className="library-panel library-empty-results">
            <span className="library-empty-icon" aria-hidden="true"><Headphones /></span>
            <h2>لا يوجد كتاب في المكتبة بعد</h2>
            <p>ارفع ملف EPUB لتبدأ تحويل الفصول إلى صوت.</p>
            <Link className="library-button library-button-primary" href="/">العودة إلى المكتبة <ArrowUpRight aria-hidden="true" /></Link>
          </section>
        ) : (
          <section className="library-panel library-listen-panel" aria-labelledby="audio-book-title">
            <div className="library-section-heading">
              <div>
                <p className="library-overline">المكتبة الحالية</p>
                <h2 id="audio-book-title">{book.title}</h2>
              </div>
              <span className="library-result-count">{readyCount} من {chapters.length} فصل جاهز</span>
            </div>

            <div className="library-player-card">
              {current ? (
                <>
                  <div className="library-overline">الفصل المحدد</div>
                  <h3>{current.number}. {current.title}</h3>
                  {current.audioUrl ? (
                    <>
                      <audio key={current.number} className="library-audio" controls preload="none" src={current.audioUrl} aria-label={`الاستماع إلى الفصل ${current.number}: ${current.title}`}>
                        متصفحك لا يدعم تشغيل الصوت.
                      </audio>
                      <a className="library-text-link" href={current.audioUrl} download={`chapter-${String(current.number).padStart(4, '0')}.wav`}>
                        تنزيل الفصل بصيغة WAV <ArrowUpRight aria-hidden="true" />
                      </a>
                    </>
                  ) : (
                    <p className="library-muted">الصوت لم يكتمل بعد · {current.partsCompleted}/{current.partsTotal} أجزاء جاهزة</p>
                  )}
                </>
              ) : <p className="library-muted">اختر فصلاً من القائمة.</p>}
            </div>

            {book.activeJob && <p className="library-live-note" role="status" aria-live="polite">المعالجة جارية: {book.activeJob.completedParts} من {book.activeJob.totalParts} أجزاء. تتحدث النتائج تلقائياً.</p>}

            <div className="library-list-controls">
              <label className="library-search" htmlFor="chapter-search">
                <Search aria-hidden="true" />
                <input id="chapter-search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="ابحث باسم الفصل أو رقمه" />
              </label>
              <div className="library-filter-row" role="group" aria-label="تصفية الفصول">
                <button type="button" aria-pressed={filter === 'ready'} onClick={() => setFilter('ready')}>جاهز</button>
                <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>الكل</button>
                <button type="button" aria-pressed={filter === 'pending'} onClick={() => setFilter('pending')}>قيد العمل</button>
              </div>
            </div>

            <div className="library-chapter-list" role="list" aria-label="فصول الكتاب">
              {visible.map((chapter) => (
                <button
                  key={chapter.number}
                  className="library-chapter-row"
                  type="button"
                  onClick={() => setSelected(chapter.number)}
                  aria-pressed={selected === chapter.number}
                >
                  <span className="library-chapter-number">{String(chapter.number).padStart(2, '0')}</span>
                  <span className="library-chapter-copy">
                    <strong>{chapter.title}</strong>
                    <small>{chapter.audioUrl ? 'جاهز للاستماع' : `${chapter.partsCompleted}/${chapter.partsTotal} أجزاء مكتملة`}</small>
                  </span>
                  <span className={`library-chapter-state ${chapter.audioUrl ? 'is-ready' : 'is-pending'}`}>{chapter.audioUrl ? 'جاهز' : chapter.status === 'error' ? 'يحتاج استئناف' : 'قيد الانتظار'}</span>
                </button>
              ))}
              {!visible.length && <p className="library-muted library-no-results">لا توجد فصول مطابقة لهذا الاختيار.</p>}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
