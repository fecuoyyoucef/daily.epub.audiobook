'use client'

import Link from 'next/link'
import { useCallback, useRef, useState, type UIEvent } from 'react'

type ReaderChapter = {
  id: string
  number: number
  title: string
  status: string
  wordCount: number
  text: string | null
}

type ReaderBook = {
  id: string
  title: string
  author: string | null
  language: string
  status: string
  chapters: Array<{ id: string; number: number; title: string; status: string; wordCount: number }>
  currentChapterNumber: number | null
  progress: number
  readingMode: string
  preferences: { theme: string; fontFamily: string; fontSize: number; lineHeight: number; textAlignment: string } | null
  bookmarks: Array<{ id: string; chapterId: string; chapterNumber: number | null; cfi: string; label: string | null; excerpt: string | null; createdAt: string }>
}

export default function ReaderClient({
  book,
  initialChapter,
  initialProgress,
}: {
  book: ReaderBook
  initialChapter: ReaderChapter | null
  initialProgress: number
}) {
  const [chapter, setChapter] = useState(initialChapter)
  const [progress, setProgress] = useState(initialProgress)
  const [bookmarks, setBookmarks] = useState(book.bookmarks)
  const [busy, setBusy] = useState(false)
  const [bookmarkBusy, setBookmarkBusy] = useState(false)
  const [message, setMessage] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const restorePercent = useRef(initialProgress)
  const currentIndex = Math.max(0, book.chapters.findIndex((item) => item.number === chapter?.number))
  const previous = book.chapters[currentIndex - 1]
  const next = book.chapters[currentIndex + 1]
  const text = chapter?.text ?? ''
  const direction = /[\u0600-\u06ff]/u.test(text) ? 'rtl' : 'ltr'
  const preferences = book.preferences ?? { theme: 'sepia', fontFamily: 'serif', fontSize: 19, lineHeight: 1.85, textAlignment: 'start' }

  async function saveCurrentPosition(percent: number) {
    if (!chapter) return
    return fetch(`/api/books/${book.id}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapterNumber: chapter.number, progressPercent: percent }),
    }).then((response) => {
      if (!response.ok) throw new Error('تعذّر حفظ موضع القراءة.')
    })
  }

  function onReaderScroll(event: UIEvent<HTMLDivElement>) {
    const element = event.currentTarget
    const maxScroll = element.scrollHeight - element.clientHeight
    const percent = maxScroll > 0 ? Math.round(element.scrollTop / maxScroll * 10000) / 100 : 0
    setProgress(percent)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void saveCurrentPosition(percent).catch(() => setMessage('تعذّر حفظ موضع القراءة.'))
    }, 900)
  }

  const attachReader = useCallback((element: HTMLDivElement | null) => {
    scrollRef.current = element
    if (!element || restorePercent.current <= 0) return
    const requestedPercent = restorePercent.current
    requestAnimationFrame(() => {
      element.scrollTop = (element.scrollHeight - element.clientHeight) * requestedPercent / 100
      restorePercent.current = 0
    })
  }, [])

  async function openChapter(number: number, requestedProgress = 0) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    const activeElement = scrollRef.current
    if (activeElement && chapter) {
      const maxScroll = activeElement.scrollHeight - activeElement.clientHeight
      const currentPercent = maxScroll > 0 ? activeElement.scrollTop / maxScroll * 100 : 0
      await saveCurrentPosition(Math.round(currentPercent * 100) / 100)
    }
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch(`/api/books/${book.id}/chapters/${number}`, { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'تعذّر فتح الفصل.')
      restorePercent.current = requestedProgress
      setChapter(result)
      setProgress(requestedProgress)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذّر فتح الفصل.')
    } finally {
      setBusy(false)
    }
  }

  async function createBookmark() {
    if (!chapter || bookmarkBusy) return
    const percent = progress
    const start = Math.floor(text.length * percent / 100)
    const excerpt = text.slice(start, start + 180).trim() || text.slice(0, 180).trim()
    setBookmarkBusy(true)
    try {
      const response = await fetch(`/api/books/${book.id}/bookmarks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapterNumber: chapter.number, progressPercent: percent, excerpt }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'تعذّر حفظ الإشارة المرجعية.')
      setBookmarks((current) => [{
        ...result.bookmark,
        chapterId: chapter.id,
        chapterNumber: chapter.number,
        cfi: `text:${percent.toFixed(2)}`,
        label: `موضع ${percent.toFixed(0)}٪`,
        excerpt,
        createdAt: new Date().toISOString(),
      }, ...current])
      setMessage('حُفظت الإشارة المرجعية.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذّر حفظ الإشارة المرجعية.')
    } finally {
      setBookmarkBusy(false)
    }
  }

  async function deleteBookmark(bookmarkId: string) {
    if (bookmarkBusy) return
    setBookmarkBusy(true)
    try {
      const response = await fetch(`/api/books/${book.id}/bookmarks/${bookmarkId}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('تعذّر حذف الإشارة المرجعية.')
      setBookmarks((current) => current.filter((bookmark) => bookmark.id !== bookmarkId))
      setMessage('حُذفت الإشارة المرجعية.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذّر حذف الإشارة المرجعية.')
    } finally {
      setBookmarkBusy(false)
    }
  }

  const themeClass = preferences.theme === 'dark' ? 'reader-dark' : preferences.theme === 'light' ? 'reader-light' : 'reader-sepia'

  return (
    <main className="wrap reader-page">
      <nav className="nav" aria-label="التنقل الرئيسي">
        <Link className="brand" href="/">قارئ الكتب الصوتي</Link>
        <div className="navlinks">
          <Link href="/">المكتبة</Link>
          <Link href="/studio/manual">استوديو الإنتاج</Link>
          <Link href="/listen">الاستماع</Link>
          <Link href="/settings">الإعدادات</Link>
        </div>
      </nav>

      <header className="reader-heading">
        <div>
          <div className="eyebrow">READING ROOM</div>
          <h1 className="title">{book.title}</h1>
          {book.author && <p className="muted">{book.author}</p>}
        </div>
        <div className="reader-actions">
          <button className="btn secondary" type="button" onClick={createBookmark} disabled={!chapter || busy || bookmarkBusy}>حفظ موضع</button>
          <Link className="btn ghost" href="/listen">الانتقال إلى الاستماع</Link>
        </div>
      </header>

      {message && <p className="notice" role="status" aria-live="polite">{message}</p>}

      <div className="reader-grid">
        <aside className="card reader-sidebar" aria-label="محتويات الكتاب والإشارات المرجعية">
          <h2>الفصول</h2>
          <nav aria-label="فصول الكتاب">
            <ol className="reader-toc">
              {book.chapters.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={item.number === chapter?.number ? 'reader-toc-button active' : 'reader-toc-button'}
                    aria-current={item.number === chapter?.number ? 'page' : undefined}
                    onClick={() => void openChapter(item.number)}
                    disabled={busy || item.status !== 'ready'}
                  >
                    <span>{item.number}. {item.title}</span>
                    <small>{item.wordCount.toLocaleString('ar')}</small>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <h2 className="reader-bookmark-heading">الإشارات المرجعية</h2>
          {bookmarks.length ? <ul className="reader-bookmarks">
            {bookmarks.map((bookmark) => {
              const savedPercent = Number(bookmark.cfi.split(':')[1]) || 0
              return <li key={bookmark.id}>
                <button type="button" className="reader-bookmark-link" onClick={() => bookmark.chapterNumber && void openChapter(bookmark.chapterNumber, savedPercent)}>
                  <strong>{bookmark.label || `الفصل ${bookmark.chapterNumber ?? ''}`}</strong>
                  {bookmark.excerpt && <span>{bookmark.excerpt}</span>}
                </button>
                <button className="reader-delete-bookmark" type="button" aria-label={`حذف الإشارة المرجعية ${bookmark.label || ''}`} onClick={() => void deleteBookmark(bookmark.id)} disabled={bookmarkBusy}>حذف</button>
              </li>
            })}
          </ul> : <p className="small muted">لم تحفظ مواضع بعد.</p>}
        </aside>

        <section className={`card reader-shell ${themeClass}`} aria-label="محتوى الفصل">
          <div className="reader-toolbar">
            <button className="btn ghost" type="button" disabled={!previous || busy} onClick={() => previous && void openChapter(previous.number)} aria-label="الفصل السابق">السابق</button>
            <div className="reader-current-title">
              <strong>{chapter ? `${chapter.number}. ${chapter.title}` : 'لا يوجد فصل جاهز'}</strong>
              <span className="small">{Math.round(progress)}٪ · {chapter?.wordCount.toLocaleString('ar') ?? 0} كلمة</span>
            </div>
            <button className="btn ghost" type="button" disabled={!next || busy} onClick={() => next && void openChapter(next.number)} aria-label="الفصل التالي">التالي</button>
          </div>

          {chapter?.text ? <div
            className="reader-text"
            key={chapter.id}
            ref={attachReader}
            onScroll={onReaderScroll}
            dir={direction}
            lang={book.language === 'und' ? undefined : book.language}
            style={{
              fontFamily: preferences.fontFamily === 'sans' ? 'Arial, sans-serif' : 'Georgia, serif',
              fontSize: `${preferences.fontSize}px`,
              lineHeight: preferences.lineHeight,
              textAlign: preferences.textAlignment === 'justify' ? 'justify' : 'start',
            }}
            tabIndex={0}
            aria-label={`نص الفصل ${chapter.number}: ${chapter.title}`}
          >
            {chapter.text.split(/\n{2,}/u).map((paragraph, index) => paragraph.trim() ? <p key={`${chapter.id}-${index}`}>{paragraph}</p> : null)}
          </div> : <div className="reader-empty"><p>لا يتوفر نص لهذا الفصل بعد.</p></div>}
        </section>
      </div>
    </main>
  )
}
