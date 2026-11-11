"use client";
import Link from "next/link";
import { useEffect,useMemo,useState } from "react";
export default function ListenPage(){
  const [book,setBook]=useState<any>(null);const [selected,setSelected]=useState<number|null>(null);const [query,setQuery]=useState("");const [filter,setFilter]=useState("ready");const [error,setError]=useState("");
  useEffect(()=>{
    let alive=true;
    async function load(){
      try{const r=await fetch("/api/status",{cache:"no-store"});const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذّر تحميل المكتبة.");
        if(alive){setBook(d.book);if(selected===null&&d.book?.chapters?.length){const first=d.book.chapters.find((c:any)=>c.audioUrl);setSelected(first?.number??d.book.chapters[0].number);}}
      }catch(e){if(alive)setError(e instanceof Error?e.message:"حدث خطأ.");}
    }
    load();const timer=setInterval(load,45000);return()=>{alive=false;clearInterval(timer);};
  },[selected]);
  const chapters=book?.chapters??[];
  const visible=useMemo(()=>chapters.filter((ch:any)=>{
    const q=`${ch.number} ${ch.title}`.toLowerCase().includes(query.toLowerCase());
    const f=filter==="all"||(filter==="ready"?!!ch.audioUrl:!ch.audioUrl);return q&&f;
  }),[chapters,query,filter]);
  const current=chapters.find((ch:any)=>ch.number===selected);
  return <main className="wrap">
    <div className="nav"><div className="brand">قارئ الكتب الصوتي</div><div className="navlinks"><Link href="/">الرئيسية</Link><Link className="active" href="/listen">الاستماع</Link><Link href="/settings">الإعدادات</Link></div></div>
    <div className="eyebrow">YOUR AUDIO LIBRARY</div><h1 className="title">مشغل الكتب الصوتية</h1>
    <p className="sub">اختر فصلاً مكتملاً من القائمة واستمع إليه داخل التطبيق. يمكنك البحث باسم الفصل أو رقمه.</p>
    {error&&<div className="notice err">{error}</div>}
    {!book?<section className="card"><p className="muted">لا يوجد كتاب في المكتبة بعد. ارفع ملف EPUB من <Link href="/">الصفحة الرئيسية</Link>.</p></section>:<section className="card">
      <h2>{book.title}</h2><div className="row"><span className="pill">{book.chapters.filter((c:any)=>c.audioUrl).length} جاهز للاستماع</span><span className="pill">{book.total} فصل</span><span className="pill">{book.progress}% تقدم</span></div>
      <div className="player">{current?<><div className="eyebrow">NOW SELECTED</div><h3 style={{marginTop:7}}>{current.number}. {current.title}</h3>
        {current.audioUrl?<><audio key={current.number} controls preload="metadata" src={current.audioUrl}>المتصفح لا يدعم تشغيل الصوت.</audio><div className="row" style={{marginTop:10}}><a className="btn secondary" href={current.audioUrl} download={`chapter-${String(current.number).padStart(4,"0")}.wav`}>تنزيل الفصل WAV</a></div></>:<p className="muted">الصوت غير جاهز بعد. الأجزاء: {current.partsCompleted}/{current.partsTotal}.</p>}
      </>:<p className="muted">اختر فصلاً من القائمة.</p>}</div>
      <div className="two"><input className="field" placeholder="ابحث عن فصل..." value={query} onChange={e=>setQuery(e.target.value)}/><select className="field" value={filter} onChange={e=>setFilter(e.target.value)}><option value="ready">الفصول الجاهزة فقط</option><option value="all">كل الفصول</option><option value="pending">الفصول غير المكتملة</option></select></div>
      <div className="list">{visible.map((ch:any)=><button key={ch.number} className={`chapterButton ${selected===ch.number?"selected":""}`} onClick={()=>setSelected(ch.number)}>
        <div className="row space"><b>{ch.number}. {ch.title}</b><span className="tag">{ch.audioUrl?"جاهز":"قيد الانتظار"}</span></div>
        <div className="small">{ch.audioUrl?"يمكن تشغيله الآن":`الأجزاء الصوتية: ${ch.partsCompleted}/${ch.partsTotal}`}</div>
      </button>)}{!visible.length&&<p className="muted">لا توجد نتائج مطابقة.</p>}</div>
    </section>}
  </main>;
}
