import { NextResponse } from "next/server";
import { defaultSettings,getManifest,saveManifest } from "@/lib/worker";
export const runtime="nodejs";
function algeriaDate(){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Algiers",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const v=Object.fromEntries(parts.map(p=>[p.type,p.value])); return `${v.year}-${v.month}-${v.day}`;
}
export async function GET(){
  try{
    const manifest=await getManifest(); if(!manifest) return NextResponse.json({configured:!!process.env.GEMINI_API_KEY,book:null});
    const settings=defaultSettings(manifest); const today=algeriaDate();
    const usage=manifest.dailyUsage?.date===today?manifest.dailyUsage:{date:today,requestsUsed:0,chaptersCompleted:0};
    const completed=manifest.chapters.filter(ch=>ch.status==="completed").length;
    const selectedTotal=manifest.chapters.filter(ch=>ch.number>=settings.startChapter&&ch.number<=settings.endChapter).length;
    const selectedCompleted=manifest.chapters.filter(ch=>ch.number>=settings.startChapter&&ch.number<=settings.endChapter&&ch.status==="completed").length;
    const next=manifest.chapters.find(ch=>ch.number>=settings.startChapter&&ch.number<=settings.endChapter&&ch.status!=="completed");
    return NextResponse.json({
      configured:!!process.env.GEMINI_API_KEY,
      book:{
        title:manifest.title,filename:manifest.filename,enabled:manifest.enabled,total:manifest.chapters.length,completed,
        progress:Math.round(completed/Math.max(manifest.chapters.length,1)*100),settings,selectedTotal,selectedCompleted,dailyUsage:usage,lastRun:manifest.lastRun??null,
        next:next?{number:next.number,title:next.title,partsCompleted:next.parts.filter(p=>p.audioPath).length,partsTotal:next.parts.length}:null,
        chapters:manifest.chapters.map(ch=>({number:ch.number,title:ch.title,status:ch.status,partsCompleted:ch.parts.filter(p=>p.audioPath).length,partsTotal:ch.parts.length,audioUrl:ch.audioPath?`/api/audio?chapter=${ch.number}`:null,error:ch.error??null}))
      }
    });
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"تعذّر قراءة الحالة."},{status:500});}
}
export async function PATCH(request:Request){
  try{
    const body=await request.json(); const manifest=await getManifest();
    if(!manifest) return NextResponse.json({error:"لا يوجد كتاب."},{status:404});
    if(typeof body.enabled==="boolean") manifest.enabled=body.enabled;
    await saveManifest(manifest);
    return NextResponse.json({ok:true,enabled:manifest.enabled});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"تعذّر تحديث الإعدادات."},{status:400});}
}
