"use client";
import Link from "next/link";
import { useCallback,useEffect,useState,type FormEvent } from "react";
type Status=any;
const MAX_FILE_BYTES=15*1024*1024;
const CHUNK_BYTES=2*1024*1024;
const RETRYABLE_UPLOAD_STATUSES=new Set([408,425,429,500,502,503,504]);
type PendingUpload={file:File;fileName:string;fileSize:number;lastModified:number;totalParts:number;idempotencyKey:string;uploadId:string|null;nextPartIndex:number};
type UploadResponse={error?:string;uploadId?:string;totalParts?:number};

class UploadRequestError extends Error{
  constructor(message:string,public readonly status?:number){super(message);this.name="UploadRequestError";}
}

const wait=(milliseconds:number)=>new Promise(resolve=>setTimeout(resolve,milliseconds));

async function postWithRetry(url:string,init:RequestInit,onRetry:(attempt:number)=>void):Promise<UploadResponse>{
  for(let attempt=1;attempt<=3;attempt++){
    let response:Response;
    try{response=await fetch(url,init);}
    catch{
      if(attempt===3)throw new UploadRequestError("انقطع الاتصال بالخادم. أعد المحاولة للمتابعة دون إعادة الأجزاء المكتملة.");
      onRetry(attempt+1);await wait(500*2**(attempt-1));continue;
    }
    const data=await response.json().catch(()=>({})) as UploadResponse;
    if(response.ok)return data;
    if(!RETRYABLE_UPLOAD_STATUSES.has(response.status)||attempt===3)throw new UploadRequestError(data.error||"تعذر إكمال طلب الرفع.",response.status);
    onRetry(attempt+1);await wait(500*2**(attempt-1));
  }
  throw new UploadRequestError("تعذر إكمال طلب الرفع.");
}

export default function Home(){
  const [status,setStatus]=useState<Status|null>(null); const [busy,setBusy]=useState(false); const [message,setMessageText]=useState(""); const [messageTone,setMessageTone]=useState<"ok"|"err">("ok");
  const setMessage=useCallback((text:string)=>{setMessageTone("ok");setMessageText(text);},[]);
  const setErrorMessage=useCallback((text:string)=>{setMessageTone("err");setMessageText(text);},[]);
  const [file,setFile]=useState<File|null>(null); const [rights,setRights]=useState(false); const [replace,setReplace]=useState(false); const [uploadProgress,setUploadProgress]=useState(0);
  const [pendingUpload,setPendingUpload]=useState<PendingUpload|null>(null);
  const refresh=useCallback(async()=>{
    try{const r=await fetch("/api/status",{cache:"no-store"});const d=await r.json();if(r.ok)setStatus(d);else setErrorMessage(d.error||"تعذّر تحميل الحالة.");}
    catch{setErrorMessage("تعذّر الاتصال بالخادم.");}
  },[]);
  useEffect(()=>{refresh();const timer=setInterval(refresh,30000);return()=>clearInterval(timer);},[refresh]);
  async function upload(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!file||!rights)return;
    if(file.size>MAX_FILE_BYTES){setErrorMessage("الحد الأقصى لحجم EPUB هو 15 MB.");return;}
    const totalParts=Math.ceil(file.size/CHUNK_BYTES);
    const canResume=pendingUpload?.file===file;
    let activeUpload:PendingUpload=canResume?pendingUpload:{file,fileName:file.name,fileSize:file.size,lastModified:file.lastModified,totalParts,idempotencyKey:crypto.randomUUID(),uploadId:null,nextPartIndex:0};
    setPendingUpload(activeUpload);setBusy(true);setUploadProgress(Math.round(activeUpload.nextPartIndex/totalParts*85));
    setMessage(activeUpload.uploadId?"استئناف رفع الملف من آخر جزء محفوظ...":"يجري تجهيز رفع خاص وآمن...");
    try{
      if(!activeUpload.uploadId){
        const initialized=await postWithRetry("/api/upload",{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({fileName:file.name,fileSize:file.size,totalParts,rightsConfirmation:rights,replace,idempotencyKey:activeUpload.idempotencyKey})
        },attempt=>setMessage(`تعذر الاتصال. إعادة محاولة بدء الرفع ${attempt}/3...`));
        if(!initialized.uploadId)throw new UploadRequestError(initialized.error||"تعذّر بدء الرفع.");
        activeUpload={...activeUpload,uploadId:initialized.uploadId};setPendingUpload(activeUpload);
      }
      const uploadId=activeUpload.uploadId;
      if(!uploadId)throw new UploadRequestError("تعذّر استعادة جلسة الرفع.");
      for(let index=activeUpload.nextPartIndex;index<totalParts;index++){
        const part=file.slice(index*CHUNK_BYTES,Math.min((index+1)*CHUNK_BYTES,file.size));
        const form=new FormData();form.append("uploadId",uploadId);form.append("index",String(index));form.append("total",String(totalParts));form.append("chunk",part,`part-${index}.bin`);
        await postWithRetry("/api/upload/chunk",{method:"POST",body:form},attempt=>setMessage(`إعادة محاولة رفع الجزء ${index+1} من ${totalParts} (${attempt}/3)...`));
        activeUpload={...activeUpload,nextPartIndex:index+1};setPendingUpload(activeUpload);
        setUploadProgress(Math.round((index+1)/totalParts*85));
      }
      setMessage("اكتمل رفع الملف. يجري الآن استخراجه في مهمة مستمرة...");
      await postWithRetry("/api/upload/complete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uploadId})},attempt=>setMessage(`إعادة محاولة بدء استخراج الكتاب (${attempt}/3)...`));
      setUploadProgress(100);setMessage("تم استلام الكتاب وبدء استخراجه. ستظهر الفصول عند اكتمال المهمة.");
      setPendingUpload(null);setFile(null);setRights(false);setReplace(false);const input=document.getElementById("epub") as HTMLInputElement|null;if(input)input.value="";await refresh();
    }catch(error){
      const statusCode=error instanceof UploadRequestError?error.status:undefined;
      if(statusCode===404){setPendingUpload(null);setErrorMessage("انتهت صلاحية جلسة الرفع. أعد المحاولة لبدء جلسة جديدة.");}
      else if(activeUpload.uploadId){
        setPendingUpload(activeUpload);
        const detail=activeUpload.nextPartIndex<totalParts?`يمكنك إعادة المحاولة؛ سيُستأنف الرفع من الجزء ${activeUpload.nextPartIndex+1} دون إعادة الأجزاء المكتملة.`:"تم حفظ جميع الأجزاء. أعد المحاولة لإكمال الاستيراد دون رفع الملف من جديد.";
        setErrorMessage(`${error instanceof Error?error.message:"حدث خطأ أثناء الرفع."} ${detail}`);
      }else setErrorMessage(error instanceof Error?error.message:"حدث خطأ أثناء الرفع.");
    }
    finally{setBusy(false);}
  }
  async function runNow(){
    setBusy(true);setMessage("يجري تنفيذ الدفعة الصوتية اليومية...");
    try{const response=await fetch("/api/run-now",{method:"POST"});const data=await response.json();if(!response.ok||data.ok===false)throw new Error(data.error||"تعذّر تشغيل الدفعة.");
      setMessage(data.skipped?data.reason:data.status==="already_running"?"توجد مهمة صوتية قيد التنفيذ بالفعل.":`بدأت مهمة صوتية لمعالجة ${data.chapters??0} فصول.`);await refresh();
    }catch(error){setErrorMessage(error instanceof Error?error.message:"حدث خطأ.");await refresh();}
    finally{setBusy(false);}
  }
  async function toggleAutomation(){
    if(!status?.book)return;setBusy(true);
    try{const response=await fetch("/api/status",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:!status.book.enabled})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||"تعذّر تغيير الإعداد.");await refresh();
    }catch(error){setErrorMessage(error instanceof Error?error.message:"حدث خطأ.");}
    finally{setBusy(false);}
  }
  const book=status?.book;const usage=book?.dailyUsage??{requestsUsed:0,chaptersCompleted:0};
  const canResumeUpload=Boolean(file&&pendingUpload?.file===file);
  return <main className="wrap">
    <div className="nav"><div className="brand">قارئ الكتب الصوتي</div><div className="navlinks"><Link className="active" href="/">الرئيسية</Link><Link href="/studio/manual">استوديو الإنتاج</Link><Link href="/listen">الاستماع</Link><Link href="/settings">الإعدادات</Link></div></div>
    <div className="eyebrow">DAILY EPUB AUDIOBOOK</div><h1 className="title">مكتبتك الصوتية، فصلًا بعد فصل</h1>
    <p className="sub">ارفع ملف EPUB مرة واحدة، وحدد نطاق الفصول والهدف اليومي. يتولى Gemini توليد الصوت، ويحفظ التطبيق الفصول المكتملة في مكتبة خاصة.</p>
    {!status?.configured&&<div className="notice">مفتاح Gemini غير مضبوط. أضف GEMINI_API_KEY في Vercel → Settings → Environment Variables ثم أعد نشر التطبيق.</div>}
    {message&&<div className={`notice ${messageTone}`} role={messageTone==="err"?"alert":"status"} aria-live={messageTone==="err"?"assertive":"polite"}>{message}{busy&&uploadProgress>0&&<div className="progress"><i style={{width:`${uploadProgress}%`}}/></div>}</div>}
    <section className="card"><div className="row space"><h2>حالة الكتاب</h2>{book&&<span className="pill">{book.status!=="ready"?"يجري استيراد الكتاب":book.enabled?"الجدولة مفعّلة":"الجدولة متوقفة"}</span>}</div>
      {!book?<p className="muted">لا يوجد كتاب في المكتبة بعد. ارفع ملف EPUB للبدء.</p>:<>
        <h3>{book.title}</h3><p className="muted">{book.filename}</p>
        {book.status!=="ready"&&<p className="small" role="status" aria-live="polite">يُستخرج محتوى الكتاب في الخلفية. ستظهر الفصول بعد اكتمال الاستيراد.</p>}
        {book.activeJob&&<p className="small" role="status" aria-live="polite">معالجة صوتية جارية: {book.activeJob.completedChapters}/{book.activeJob.totalChapters} فصول، {book.activeJob.completedParts}/{book.activeJob.totalParts} أجزاء، {book.activeJob.requestsUsed+book.activeJob.requestsReserved} طلبات مستخدمة أو محجوزة.</p>}
        {!book.activeJob&&book.lastRun?.message&&<p className="small" role="status">{book.lastRun.message}</p>}
        <div className="grid" style={{marginTop:16}}>
          <div className="stat"><strong>{book.selectedCompleted}/{book.selectedTotal}</strong><span className="muted">فصول مكتملة في النطاق</span></div>
          <div className="stat"><strong>{usage.requestsUsed}/10</strong><span className="muted">طلبات TTS اليوم</span></div>
          <div className="stat"><strong>{book.settings.dailyTarget}</strong><span className="muted">الهدف اليومي للفصول</span></div>
        </div>
        <div className="progress"><i style={{width:`${book.progress}%`}}/></div>
        <p className="small">النطاق الحالي: {book.settings.startChapter}–{book.settings.endChapter} من {book.total} · التقدم الإجمالي {book.progress}%</p>
        {book.next&&<p className="small">الفصل التالي: {book.next.number} — {book.next.title} ({book.next.partsCompleted}/{book.next.partsTotal} أجزاء)</p>}
        <div className="row" style={{marginTop:14}}>
          <button className="btn" onClick={runNow} disabled={busy||!status?.configured||usage.requestsUsed>=10}>تشغيل الدفعة الآن</button>
          <button className="btn secondary" onClick={toggleAutomation} disabled={busy}>{book.enabled?"إيقاف الجدولة":"استئناف الجدولة"}</button>
          <Link className="btn ghost" href={`/read/${book.id}`}>اقرأ الكتاب</Link><Link className="btn ghost" href="/listen">افتح مشغل الصوت</Link><Link className="btn ghost" href="/settings">إعدادات النطاق</Link>
        </div>
      </>}
    </section>
    <section className="card"><h2>رفع كتاب EPUB</h2><form onSubmit={upload}>
      <label className="label" htmlFor="epub">ملف EPUB — حتى 15 MB</label><input id="epub" className="field" type="file" accept=".epub,application/epub+zip" disabled={busy} onChange={e=>setFile(e.target.files?.[0]??null)}/>
      <p className="small">يُنقل الملف على أجزاء صغيرة لتجاوز حدود حجم طلبات Vercel، ثم تُستخرج الفصول وترتب بحسب ملف EPUB.</p>
      <label className="check"><input type="checkbox" checked={rights} disabled={busy} onChange={e=>setRights(e.target.checked)}/> أؤكد أنني أملك حقوق النص أو لدي إذن صريح بتحويله إلى نسخة صوتية.</label>
      {book&&<label className="check"><input type="checkbox" checked={replace} disabled={busy} onChange={e=>setReplace(e.target.checked)}/> استبدال الكتاب الحالي وبدء مكتبة جديدة. ستبقى الملفات القديمة في التخزين الخاص لكنها لن تظهر في المكتبة.</label>}
      <button className="btn" type="submit" disabled={busy||!file||!rights||!!book&&!replace}>{busy?"جارٍ الرفع والمعالجة...":canResumeUpload?"استئناف رفع الكتاب":"رفع الكتاب واستخراج الفصول"}</button>
    </form></section>
    <section className="card"><h2>حدود التشغيل الحالية</h2><div className="grid"><div className="stat"><strong>10</strong><span className="muted">طلبات TTS كحد يومي</span></div><div className="stat"><strong>3</strong><span className="muted">طلبات بالدقيقة</span></div><div className="stat"><strong>15 MB</strong><span className="muted">حجم EPUB الأقصى</span></div></div>
      <p className="small">عدد الفصول المنجزة يعتمد على طولها؛ فكل جزء من فصل طويل يستهلك طلب TTS مستقلاً. يحافظ النظام على الأجزاء المكتملة ويستكمل الباقي لاحقاً. الجدولة تعمل يومياً عند 07:00 بتوقيت الجزائر.</p></section>
    <div className="footer">التخزين خاص. لا يرسل التطبيق مفتاح Gemini إلى المتصفح. استخدم الكتب التي تملك حق تحويلها أو إذناً بها.</div>
  </main>;
}
