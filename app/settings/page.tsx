"use client";
import Link from "next/link";
import { useEffect,useState,type FormEvent } from "react";
export default function SettingsPage(){
  const [book,setBook]=useState<any>(null);const [start,setStart]=useState("1");const [end,setEnd]=useState("1");const [target,setTarget]=useState("10");
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");
  async function refresh(){
    try{const r=await fetch("/api/status",{cache:"no-store"});const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذّر قراءة الحالة.");
      setBook(d.book);if(d.book?.settings){setStart(String(d.book.settings.startChapter));setEnd(String(d.book.settings.endChapter));setTarget(String(d.book.settings.dailyTarget));}
    }catch(e){setMessage(e instanceof Error?e.message:"حدث خطأ.");}
  }
  useEffect(()=>{refresh();},[]);
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);setMessage("");
    try{const r=await fetch("/api/settings",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({startChapter:Number(start),endChapter:Number(end),dailyTarget:Number(target)})});
      const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذّر حفظ الإعدادات.");setMessage("تم حفظ الإعدادات. ستطبق على التشغيل القادم.");await refresh();
    }catch(e){setMessage(e instanceof Error?e.message:"حدث خطأ.");}finally{setBusy(false);}
  }
  return <main className="wrap">
    <div className="nav"><div className="brand">قارئ الكتب الصوتي</div><div className="navlinks"><Link href="/">الرئيسية</Link><Link href="/listen">الاستماع</Link><Link className="active" href="/settings">الإعدادات</Link></div></div>
    <div className="eyebrow">PLAYBACK SCHEDULE</div><h1 className="title">إعدادات المعالجة اليومية</h1>
    <p className="sub">اختر نطاق الفصول التي تريد تحويلها، وحدد كم فصلاً يستهدف العامل إكماله كل يوم.</p>
    {message&&<div className="notice ok">{message}</div>}
    <section className="card">{!book?<p className="muted">ارفع كتاب EPUB أولاً لتظهر إعدادات النطاق.</p>:<>
      <h2>{book.title}</h2><p className="muted">عدد الفصول المستخرجة: {book.total}</p>
      <form onSubmit={save}>
        <div className="two">
          <div><label className="label" htmlFor="start">أول فصل في النطاق</label><input className="field" id="start" type="number" min="1" max={book.total} value={start} onChange={e=>setStart(e.target.value)} required/></div>
          <div><label className="label" htmlFor="end">آخر فصل في النطاق</label><input className="field" id="end" type="number" min="1" max={book.total} value={end} onChange={e=>setEnd(e.target.value)} required/></div>
        </div>
        <label className="label" htmlFor="target">هدف الفصول المكتملة يومياً (1–10)</label>
        <select className="field" id="target" value={target} onChange={e=>setTarget(e.target.value)}>{Array.from({length:10},(_,i)=>i+1).map(n=><option key={n} value={n}>{n} {n===1?"فصل":"فصول"} يومياً</option>)}</select>
        <div className="notice">النطاق متصل وشامل رقمي البداية والنهاية. كل جزء من فصل طويل يُحتسب كطلب TTS منفصل ضمن الحصة اليومية البالغة 10 طلبات.</div>
        <div className="row"><button className="btn" type="submit" disabled={busy}>{busy?"جارٍ الحفظ...":"حفظ الإعدادات"}</button><button className="btn secondary" type="button" onClick={()=>{setStart("1");setEnd(String(book.total));setTarget("10");}}>كل الفصول</button></div>
      </form>
    </>}</section>
    <section className="card"><h2>كيفية حساب الهدف</h2><p className="small">الهدف اليومي سقف للفصول المكتملة التي يسعى النظام إلى إنجازها، وليس ضماناً بإكمال العدد كله كل يوم. الحصة الحالية تسمح بعشرة طلبات TTS فقط؛ وقد تستهلك الفصول الطويلة عدة طلبات. لا يعيد النظام توليد الأجزاء المحفوظة.</p></section>
  </main>;
}
