import { NextRequest,NextResponse } from "next/server";
import { defaultSettings,getManifest,saveManifest } from "@/lib/worker";
export const runtime="nodejs";
export async function PATCH(request:NextRequest){
  try{
    const body=await request.json(); const manifest=await getManifest();
    if(!manifest) return NextResponse.json({error:"ارفع كتاب EPUB أولاً."},{status:404});
    const current=defaultSettings(manifest); const start=Number(body.startChapter??current.startChapter);
    const end=Number(body.endChapter??current.endChapter); const target=Number(body.dailyTarget??current.dailyTarget); const total=manifest.chapters.length;
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||end>total||start>end) return NextResponse.json({error:`اختر نطاقاً صحيحاً بين 1 و${total}، ويجب ألا يتجاوز رقم البداية رقم النهاية.`},{status:400});
    if(!Number.isInteger(target)||target<1||target>10) return NextResponse.json({error:"الهدف اليومي يجب أن يكون عدداً صحيحاً من 1 إلى 10 فصول."},{status:400});
    manifest.settings={startChapter:start,endChapter:end,dailyTarget:target}; await saveManifest(manifest);
    return NextResponse.json({ok:true,settings:manifest.settings});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"تعذّر حفظ الإعدادات."},{status:400});}
}
