import { NextRequest,NextResponse } from "next/server";
import { putPrivate } from "@/lib/store";
export const runtime="nodejs"; export const maxDuration=30;
const MAX_CHUNK_BYTES=2*1024*1024;
export async function POST(request:NextRequest){
  try{
    const form=await request.formData(); const file=form.get("chunk");
    const uploadId=String(form.get("uploadId")??""); const index=Number(form.get("index")); const total=Number(form.get("total"));
    if(!/^[a-zA-Z0-9-]{16,64}$/.test(uploadId)) return NextResponse.json({error:"معرّف الرفع غير صالح."},{status:400});
    if(!(file instanceof File)) return NextResponse.json({error:"جزء الملف مفقود."},{status:400});
    if(!Number.isInteger(index)||!Number.isInteger(total)||total<1||total>8||index<0||index>=total) return NextResponse.json({error:"بيانات أجزاء الرفع غير صالحة."},{status:400});
    if(file.size<=0||file.size>MAX_CHUNK_BYTES) return NextResponse.json({error:"حجم الجزء يتجاوز 2 MB أو أنه فارغ."},{status:413});
    await putPrivate(`uploads/${uploadId}/part-${String(index).padStart(2,"0")}.bin`,Buffer.from(await file.arrayBuffer()),"application/octet-stream");
    return NextResponse.json({ok:true,index,total});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"تعذّر حفظ جزء الملف."},{status:500});}
}
