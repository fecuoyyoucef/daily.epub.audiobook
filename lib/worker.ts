import { MANIFEST_PATH, putLock, putPrivate, readJson, readPrivate, writeJson } from "./store";
import { estimateTokens } from "./epub";
import { generateArabicSpeech } from "./tts";

export type ChapterPart={textPath:string;estimatedTokens:number;audioPath?:string};
export type BookChapter={number:number;title:string;status:"pending"|"processing"|"completed"|"error";parts:ChapterPart[];audioPath?:string;error?:string};
export type BookSettings={startChapter:number;endChapter:number;dailyTarget:number};
export type BookManifest={
  bookId:string;title:string;filename:string;createdAt:string;enabled:boolean;chapters:BookChapter[];
  settings?:BookSettings;
  dailyUsage?:{date:string;requestsUsed:number;chaptersCompleted:number};
  lastRun?:{date:string;requestsUsed:number;chaptersCompleted:number;message:string;finishedAt:string};
  lastAttemptAt?:string;lastError?:string;
};
export async function getManifest(){return readJson<BookManifest>(MANIFEST_PATH);}
export async function saveManifest(value:BookManifest){await writeJson(MANIFEST_PATH,value);}
export function defaultSettings(manifest:BookManifest):BookSettings{
  return manifest.settings??{startChapter:1,endChapter:Math.max(manifest.chapters.length,1),dailyTarget:10};
}
function algeriaDate(){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Algiers",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const v=Object.fromEntries(parts.map(p=>[p.type,p.value])); return `${v.year}-${v.month}-${v.day}`;
}
function pcmFromAudio(audio:Buffer):Buffer{
  if(audio.length>=44&&audio.toString("ascii",0,4)==="RIFF"&&audio.toString("ascii",8,12)==="WAVE"){
    let offset=12;
    while(offset+8<=audio.length){
      const id=audio.toString("ascii",offset,offset+4); const size=audio.readUInt32LE(offset+4); const start=offset+8;
      if(id==="data") return audio.subarray(start,Math.min(start+size,audio.length));
      offset=start+size+(size%2);
    }
  }
  return audio;
}
function wavFromPcm(pcm:Buffer):Buffer{
  const h=Buffer.alloc(44); h.write("RIFF",0); h.writeUInt32LE(36+pcm.length,4); h.write("WAVE",8);
  h.write("fmt ",12); h.writeUInt32LE(16,16); h.writeUInt16LE(1,20); h.writeUInt16LE(1,22);
  h.writeUInt32LE(24000,24); h.writeUInt32LE(48000,28); h.writeUInt16LE(2,32); h.writeUInt16LE(16,34);
  h.write("data",36); h.writeUInt32LE(pcm.length,40); return Buffer.concat([h,pcm]);
}
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
type RequestStamp={at:number;tokens:number};
async function waitForGeminiBudget(tokens:number,stamps:RequestStamp[],deadline:number):Promise<boolean>{
  while(true){
    const now=Date.now(); while(stamps.length&&now-stamps[0].at>=60_000) stamps.shift();
    const used=stamps.reduce((n,s)=>n+s.tokens,0);
    if(stamps.length<3&&used+tokens<=10_000) return true;
    if(!stamps.length&&tokens<=10_000) return true;
    const wait=Math.max(1000,stamps[0].at+60_500-now);
    if(now+wait>deadline) return false;
    await pause(wait);
  }
}
function errorText(error:unknown){return error instanceof Error?error.message.slice(0,500):"خطأ غير معروف";}

export async function processDailyBatch():Promise<Record<string,unknown>>{
  const date=algeriaDate();
  const manifest=await getManifest();
  if(!manifest) return {ok:true,skipped:true,reason:"لا يوجد كتاب مرفوع بعد."};
  if(!manifest.enabled) return {ok:true,skipped:true,reason:"الجدولة متوقفة."};
  try{await putLock(`locks/${date}.lock`);}
  catch{return {ok:true,skipped:true,reason:"تم تشغيل مهمة اليوم بالفعل."};}

  const settings=defaultSettings(manifest); manifest.settings=settings;
  const usage=manifest.dailyUsage?.date===date?manifest.dailyUsage:{date,requestsUsed:0,chaptersCompleted:0};
  manifest.dailyUsage=usage;
  const requestLimit=Math.max(0,10-usage.requestsUsed);
  const chapterLimit=Math.max(0,settings.dailyTarget-usage.chaptersCompleted);
  if(!requestLimit||!chapterLimit){
    manifest.lastRun={date,requestsUsed:usage.requestsUsed,chaptersCompleted:usage.chaptersCompleted,message:"تم بلوغ هدف اليوم أو سقف الطلبات.",finishedAt:new Date().toISOString()};
    await saveManifest(manifest); return {ok:true,skipped:true,reason:"تم بلوغ هدف اليوم أو سقف طلبات TTS."};
  }

  const deadline=Date.now()+270_000; const stamps:RequestStamp[]=[];
  let callsThisRun=0; let chaptersCompletedThisRun=0;
  let message="اكتملت الدفعة اليومية.";
  const selected=manifest.chapters.filter(ch=>ch.number>=settings.startChapter&&ch.number<=settings.endChapter&&ch.status!=="completed");

  for(const chapter of selected){
    if(chaptersCompletedThisRun>=chapterLimit||usage.requestsUsed>=10||Date.now()>deadline-12_000){
      message="توقف التشغيل عند بلوغ حد الوقت أو الميزانية اليومية؛ سيُستأنف التقدم غداً."; break;
    }
    chapter.status="processing"; chapter.error=undefined;
    for(const part of chapter.parts){
      if(part.audioPath) continue;
      if(usage.requestsUsed>=10||callsThisRun>=requestLimit){
        message="اكتمل سقف طلبات Gemini اليوم؛ سيُستأنف هذا الفصل غداً."; break;
      }
      const textBuffer=await readPrivate(part.textPath);
      if(!textBuffer){chapter.status="error";chapter.error=`النص المحفوظ مفقود: ${part.textPath}`;manifest.lastError=chapter.error;message=chapter.error;break;}
      const source=textBuffer.toString("utf8"); const estimate=estimateTokens(source);
      if(estimate>8192){chapter.status="error";chapter.error=`الجزء ${estimate} Token وفق التقدير؛ يتجاوز حد 8,192.`;manifest.lastError=chapter.error;message=chapter.error;break;}
      if(!await waitForGeminiBudget(estimate,stamps,deadline)){
        message="انتهت نافذة التنفيذ قبل توفر سعة TPM؛ سيُستأنف الفصل غداً."; break;
      }
      usage.requestsUsed+=1; callsThisRun+=1; manifest.dailyUsage=usage;
      manifest.lastAttemptAt=new Date().toISOString(); await saveManifest(manifest);
      stamps.push({at:Date.now(),tokens:estimate});
      try{
        const audio=await generateArabicSpeech(source);
        const partNo=chapter.parts.indexOf(part)+1;
        const path=`audio/${manifest.bookId}/chapter-${String(chapter.number).padStart(4,"0")}-part-${String(partNo).padStart(2,"0")}.wav`;
        await putPrivate(path,audio,"audio/wav"); part.audioPath=path; await saveManifest(manifest);
      }catch(error){
        chapter.status="error"; chapter.error=errorText(error); manifest.lastError=chapter.error; message=chapter.error; await saveManifest(manifest); break;
      }
    }
    if(chapter.status==="error") break;
    if(!chapter.parts.every(p=>!!p.audioPath)){
      chapter.status="processing"; await saveManifest(manifest);
      if(!message||message==="اكتملت الدفعة اليومية.") message="الفصل التالي لم يكتمل بعد؛ سيُستأنف من الجزء المتبقي.";
      break;
    }
    try{
      const pcm:Buffer[]=[];
      for(const part of chapter.parts){
        const audio=await readPrivate(part.audioPath!); if(!audio) throw new Error("تعذّر قراءة جزء صوتي سابق عند تجميع الفصل.");
        pcm.push(pcmFromAudio(audio));
      }
      const finalPath=`audio/${manifest.bookId}/chapter-${String(chapter.number).padStart(4,"0")}.wav`;
      await putPrivate(finalPath,wavFromPcm(Buffer.concat(pcm)),"audio/wav");
      chapter.audioPath=finalPath; chapter.status="completed"; chapter.error=undefined;
      usage.chaptersCompleted+=1; chaptersCompletedThisRun+=1; manifest.lastError=undefined; await saveManifest(manifest);
    }catch(error){
      chapter.status="error";chapter.error=errorText(error);manifest.lastError=chapter.error;message=chapter.error;await saveManifest(manifest);break;
    }
  }

  manifest.dailyUsage=usage;
  manifest.lastRun={date,requestsUsed:usage.requestsUsed,chaptersCompleted:usage.chaptersCompleted,message,finishedAt:new Date().toISOString()};
  await saveManifest(manifest);
  return {ok:true,date,requestsUsedToday:usage.requestsUsed,chaptersCompletedToday:usage.chaptersCompleted,requestsUsedThisRun:callsThisRun,chaptersCompletedThisRun,dailyTarget:settings.dailyTarget,range:{start:settings.startChapter,end:settings.endChapter},message};
}
