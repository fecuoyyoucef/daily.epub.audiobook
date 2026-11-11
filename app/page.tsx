"use client";
import Link from "next/link";
import { useCallback,useEffect,useState,type FormEvent } from "react";
type Status=any; const MAX_FILE_BYTES=15*1024*1024; const CHUNK_BYTES=2*1024*1024;
export default function Home(){
  const [status,setStatus]=useState<Status|null>(null); const [busy,setBusy]=useState(false); const [message,setMessage]=useState("");
  const [file,setFile]=useState<File|null>(null); const [rights,setRights]=useState(false); const [replace,setReplace]=useState(false); const [uploadProgress,setUploadProgress]=useState(0);
  const refresh=useCallback(async()=>{
    try{const r=await fetch("/api/status",{cache:"no-store"});const d=await r.json();if(r.ok)setStatus(d);else setMessage(d.error||"تعذّر تحميل الحالة.");}
    catch{setMessage("تعذّر الاتصال بالخادم.");}
  },[]);
  useEffect(()=>{refresh();const timer=setInterval(refresh,30000);return()=>clearInterval(timer);},[refresh]);
  async function upload(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!file||!rights)return;
    if(file.size>MAX_FILE_BYTES){setMessage("الحد الأقصى لحجم EPUB هو 15 MB.");return;}
    setBusy(true);setUploadProgress(0);setMessage("يجري رفع ملف EPUB على أجزاء...");
    try{
      const uploadId=crypto.randomUUID();const totalParts=Math.ceil(file.size/CHUNK_BYTES);
      for(let index=0;index<totalParts;index++){
        const part=file.slice(index*CHUNK_BYTES,Math.min((index+1)*CHUNK_BYTES,file.size));
        const form=new FormData();form.append("uploadId",uploadId);form.append("index",String(index));form.append("total",String(totalParts));form.append("chunk",part,`part-${index}.bin`);
        const response=await fetch("/api/upload/chunk",{method:"POST",body:form});const data=await response.json();
        if(!response.ok)throw new Error(data.error||`فشل رفع الجزء ${index+1}.`);
        setUploadProgress(Math.round((index+1)/totalParts*85));
      }
      setMessage("اكتمل الرفع. يجري فحص EPUB واستخراج الفصول...");
      const response=await fetch("/api/upload/complete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uploadId,fileName:file.name,fileSize:file.size,totalParts,rightsConfirmation:rights,replace})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||"فشل تحليل الكتاب.");
      setUploadProgress(100);setMessage(`تم تسجيل "${data.title}" بنجاح: ${data.chapters} فصلاً و${data.parts} جزءاً صوتياً.`);
      setFile(null);setRights(false);setReplace(false);const input=document.getElementById("epub") as HTMLInputElement|null;if(input)input.value="";await refresh();
    }catch(error){setMessage(error instanceof Error?error.message:"حدث خطأ أثناء الرفع.");}
    finally{setBusy(false);}
  }
  async function runNow(){
    setBusy(true);setMessage("يجري تنفيذ الدفعة الصوتية اليومية...");
    try{const response=await fetch("/api/run-now",{method:"POST"});const data=await response.json();if(!response.ok||data.ok===false)throw new Error(data.error||"تعذّر تشغيل الدفعة.");
      setMessage(data.skipped?data.reason:data.message||`اكتملت الدفعة: ${data.chaptersCompletedThisRun} فصول، و${data.requestsUsedThisRun} طلبات TTS.`);await refresh();
    }catch(error){setMessage(error instanceof Error?error.message:"حدث خطأ.");await refresh();}
    finally{setBusy(false);}
  }
  async function toggleAutomation(){
    if(!status?.book)return;setBusy(true);
    try{const response=await fetch("/api/status",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:!status.book.enabled})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||"تعذّر تغيير الإعداد.");await refresh();
    }catch(error){setMessage(error instanceof Error?error.message:"حدث خطأ.");}
    finally{setBusy(false);}
  }
  const book=status?.book;const usage=book?.dailyUsage??{requestsUsed:0,chaptersCompleted:0};
  return <main className="wrap">
    <div className="nav"><div className="brand">قارئ الكتب الصوتي</div><div className="navlinks"><Link className="active" href="/">الرئيسية</Link><Link href="/listen">الاستماع</Link><Link href="/settings">الإعدادات</Link></div></div>
    <div className="eyebrow">DAILY EPUB AUDIOBOOK</div><h1 className="title">مكتبتك الصوتية، فصلًا بعد فصل</h1>
    <p className="sub">ارفع ملف EPUB مرة واحدة، وحدد نطاق الفصول والهدف اليومي. يتولى Gemini توليد الصوت، ويحفظ التطبيق الفصول المكتملة في مكتبة خاصة.</p>
    {!status?.configured&&<div className="notice">مفتاح Gemini غير مضبوط. أضف GEMINI_API_KEY في Vercel → Settings → Environment Variables ثم أعد نشر التطبيق.</div>}
    {message&&<div className="notice ok">{message}{busy&&uploadProgress>0&&<div className="progress"><i style={{width:`${uploadProgress}%`}}/></div>}</div>}
    <section className="card"><div className="row space"><h2>حالة الكتاب</h2>{book&&<span className="pill">{book.enabled?"الجدولة مفعّلة":"الجدولة متوقفة"}</span>}</div>
      {!book?<p className="muted">لا يوجد كتاب في المكتبة بعد. ارفع ملف EPUB للبدء.</p>:<>
        <h3>{book.title}</h3><p className="muted">{book.filename}</p>
        <div className="grid" style={{marginTop:16}}>
          <div className="stat"><strong>{book.selectedCompleted}/{book.selectedTotal}</strong><span className="muted">فصول مكتملة في النطاق</span></div>
          <div className="stat"><strong>{usage.requestsUsed}/10</strong><span className="muted">طلبات TTS اليوم</span></div>
          <div className="stat"><strong>{book.settings.dailyTarget}</strong><span className="muted">الهدف اليومي للفصول</span></div>
        </div>
        <div className="progress"><i style={{width:`${book.progress}%`}}/></div>
        <p className="small">النطاق الحالي: {book.settings.startChapter}–{book.settings.endChapter} من {book.total} · التقدم الإجمالي {book.progress}%</p>
        {book.next&&<p className="small">الفصل التالي: {book.next.number} — {book.next.title} ({book.next.partsCompleted}/{book.next.partsTotal} أجزاء)</p>}
        <div className="row" style={{marginTop:14}}>
          <button className="btn" onClick={runNow} disabled={busy||!status?.configured||!book.enabled||usage.requestsUsed>=10}>تشغيل الدفعة الآن</button>
          <button className="btn secondary" onClick={toggleAutomation} disabled={busy}>{book.enabled?"إيقاف الجدولة":"استئناف الجدولة"}</button>
          <Link className="btn ghost" href="/listen">افتح مشغل الصوت</Link><Link className="btn ghost" href="/settings">إعدادات النطاق</Link>
        </div>
      </>}
    </section>
    <section className="card"><h2>رفع كتاب EPUB</h2><form onSubmit={upload}>
      <label className="label" htmlFor="epub">ملف EPUB — حتى 15 MB</label><input id="epub" className="field" type="file" accept=".epub,application/epub+zip" onChange={e=>setFile(e.target.files?.[0]??null)}/>
      <p className="small">يُنقل الملف على أجزاء صغيرة لتجاوز حدود حجم طلبات Vercel، ثم تُستخرج الفصول وترتب بحسب ملف EPUB.</p>
      <label className="check"><input type="checkbox" checked={rights} onChange={e=>setRights(e.target.checked)}/> أؤكد أنني أملك حقوق النص أو لدي إذن صريح بتحويله إلى نسخة صوتية.</label>
      {book&&<label className="check"><input type="checkbox" checked={replace} onChange={e=>setReplace(e.target.checked)}/> استبدال الكتاب الحالي وبدء مكتبة جديدة. ستبقى الملفات القديمة في التخزين الخاص لكنها لن تظهر في المكتبة.</label>}
      <button className="btn" type="submit" disabled={busy||!file||!rights||!!book&&!replace}>{busy?"جارٍ الرفع والمعالجة...":"رفع الكتاب واستخراج الفصول"}</button>
    </form></section>
    <section className="card"><h2>حدود التشغيل الحالية</h2><div className="grid"><div className="stat"><strong>10</strong><span className="muted">طلبات TTS كحد يومي</span></div><div className="stat"><strong>3</strong><span className="muted">طلبات بالدقيقة</span></div><div className="stat"><strong>15 MB</strong><span className="muted">حجم EPUB الأقصى</span></div></div>
      <p className="small">عدد الفصول المنجزة يعتمد على طولها؛ فكل جزء من فصل طويل يستهلك طلب TTS مستقلاً. يحافظ النظام على الأجزاء المكتملة ويستكمل الباقي لاحقاً. الجدولة تعمل يومياً عند 07:00 بتوقيت الجزائر.</p></section>
    <div className="footer">التخزين خاص. لا يرسل التطبيق مفتاح Gemini إلى المتصفح. استخدم الكتب التي تملك حق تحويلها أو إذناً بها.</div>
  </main>;
}
