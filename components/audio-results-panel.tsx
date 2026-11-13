import Link from 'next/link'
import { ArrowUpLeft, AudioLines, Headphones, Play } from 'lucide-react'
import type { LibraryBook } from './use-library-status'

export function AudioResultsPanel({ book }: { book: LibraryBook }) {
  const readyChapters = book.chapters.filter((chapter) => chapter.audioUrl)
  const featured = readyChapters.length ? readyChapters[readyChapters.length - 1] : null
  const recent = readyChapters.slice(-4).reverse()

  return (
    <section className="library-panel library-results" aria-labelledby="audio-results-title">
      <div className="library-section-heading">
        <div>
          <p className="library-overline">مخرجاتك</p>
          <h2 id="audio-results-title">الفصول الجاهزة للاستماع</h2>
        </div>
        <span className="library-result-count">{readyChapters.length} فصل</span>
      </div>

      {featured ? (
        <>
          <div className="library-featured-result">
            <div className="library-featured-icon" aria-hidden="true"><Play /></div>
            <div className="library-featured-copy">
              <span className="library-overline">أحدث نتيجة</span>
              <h3>{featured.number}. {featured.title}</h3>
            </div>
            <Link className="library-icon-link" href={`/listen?chapter=${featured.number}`} aria-label={`فتح الفصل ${featured.number} في مشغل الصوت`}>
              <ArrowUpLeft aria-hidden="true" />
            </Link>
          </div>
          <audio className="library-audio" controls preload="none" src={featured.audioUrl ?? undefined} aria-label={`الاستماع إلى الفصل ${featured.number}: ${featured.title}`}>
            متصفحك لا يدعم تشغيل الصوت.
          </audio>
          <ul className="library-result-list" aria-label="الفصول الصوتية الأخيرة">
            {recent.map((chapter) => (
              <li key={chapter.number}>
                <Link href={`/listen?chapter=${chapter.number}`} className="library-result-link">
                  <span className="library-result-number">{String(chapter.number).padStart(2, '0')}</span>
                  <span className="library-result-title">{chapter.title}</span>
                  <span className="library-result-ready">جاهز</span>
                </Link>
              </li>
            ))}
          </ul>
          <Link className="library-text-link" href="/listen">فتح المكتبة الصوتية <ArrowUpLeft aria-hidden="true" /></Link>
        </>
      ) : (
        <div className="library-empty-results">
          <span className="library-empty-icon" aria-hidden="true"><AudioLines /></span>
          <h3>نتيجتك الأولى في الطريق</h3>
          <p>عند اكتمال فصل، سيظهر هنا مع مشغّل جاهز للاستماع.</p>
          {book.next && <span className="library-next-label">التالي: {book.next.number}. {book.next.title}</span>}
        </div>
      )}
    </section>
  )
}
