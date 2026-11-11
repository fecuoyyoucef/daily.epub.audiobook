import { NextRequest,NextResponse } from "next/server";
import { MANIFEST_PATH,putPrivate,readJson,readPrivate,writeJson } from "@/lib/store";
import { parseEpub,splitForTts,estimateTokens } from "@/lib/epub";
import type { BookManifest } from "@/lib/worker";
export const runtime="nodejs"; export const maxDuration=300;
const MAX_FILE_BYTES=15*1024*1024; const PART_BYTES=2*1024*1024;
export async function POST(request:NextRequest){
  try{
    const body=await request.json(); const uploadId=String(body.uploadId??""); const fileName=String(body.fileName??"book.epub").slice(0,180);
    const fileSize=Number(body.fileSize); const totalParts=Number(body.totalParts); const rights=body.rightsConfirmation===true; const replace=body.replace===true;
    if(!/^[a-zA-Z0-9-]{16,64}$/.test(uploadId)) return NextResponse.json({error:"معرّف الرفع غير صالح."},{status:400});
    if(!rights) return NextResponse.json({error:"يلزم تأكيد امتلاك حق الاستخدام أو الإذن بتحويل الكتاب."},{status:400});
    if(!fileName.toLowerCase().endsWith(".epub")) return NextResponse.json({error:"يجب أن يكون الملف بصيغة EPUB."},{status:400});
    if(!Number.isInteger(fileSize)||fileSize<=0||fileSize>MAX_FILE_BYTES) return NextResponse.json({error:"حجم EPUB يتجاوز 15 MB."},{status:413});
    if(!Number.isInteger(totalParts)||totalParts<1||totalParts>8||totalParts!==Math.ceil(fileSize/PART_BYTES)) return NextResponse.json({error:"عدد أجزاء الرفع لا يتطابق مع حجم الملف."},{status:400});
    const old=await readJson<BookManifest>(MANIFEST_PATH); if(old&&!replace) return NextResponse.json({error:"يوجد كتاب مسجل. اختر استبدال الكتاب الحالي لبدء مكتبة جديدة."},{status:409});
    const chunks:Buffer[]=[];
    for(let i=0;i<totalParts;i++){
      const p=await readPrivate(`uploads/${uploadId}/part-${String(i).padStart(2,"0")}.bin`);
      if(!p) return NextResponse.json({error:`جزء الرفع رقم ${i+1} مفقود. أعد رفع الملف.`},{status:400});
      const expected=i===totalParts-1?fileSize-PART_BYTES*i:PART_BYTES;
      if(p.length!==expected) return NextResponse.json({error:`حجم الجزء رقم ${i+1} غير مطابق.`},{status:400});
      chunks.push(p);
    }
    const buffer=Buffer.concat(chunks); if(buffer.length!==fileSize) return NextResponse.json({error:"الملف المجمع لا يطابق الحجم الأصلي."},{status:400});
    const parsed=parseEpub(buffer); const bookId=`book-${Date.now().toString(36)}`;
    await putPrivate(`source/${bookId}.epub`,buffer,"application/epub+zip");
    const chapters:BookManifest["chapters"]=[];
    for(let i=0;i<parsed.chapters.length;i++){
      const chapter=parsed.chapters[i]; const pieces=splitForTts(chapter.text); const parts:BookManifest["chapters"][number]["parts"]=[];
      for(let p=0;p<pieces.length;p++){
        const path=`texts/${bookId}/chapter-${String(i+1).padStart(4,"0")}-part-${String(p+1).padStart(2,"0")}.txt`;
        await putPrivate(path,Buffer.from(pieces[p],"utf8"),"text/plain; charset=utf-8");
        parts.push({textPath:path,estimatedTokens:estimateTokens(pieces[p])});
      }
      chapters.push({number:i+1,title:chapter.title,status:"pending",parts});
    }
    const manifest:BookManifest={bookId,title:parsed.title,filename:fileName,createdAt:new Date().toISOString(),enabled:true,chapters,settings:{startChapter:1,endChapter:chapters.length,dailyTarget:10},dailyUsage:{date:"not-started",requestsUsed:0,chaptersCompleted:0}};
    await writeJson(MANIFEST_PATH,manifest);
    return NextResponse.json({ok:true,title:manifest.title,chapters:chapters.length,parts:chapters.reduce((n,ch)=>n+ch.parts.length,0),maxDailyTarget:10});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"فشل تحليل EPUB."},{status:400});}
}
