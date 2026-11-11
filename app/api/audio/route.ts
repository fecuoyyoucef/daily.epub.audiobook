import { NextRequest,NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { getManifest } from "@/lib/worker";
export const runtime="nodejs";
export async function GET(request:NextRequest){
  const number=Number(request.nextUrl.searchParams.get("chapter"));
  if(!Number.isInteger(number)||number<1) return new NextResponse("رقم فصل غير صالح.",{status:400});
  const manifest=await getManifest(); const chapter=manifest?.chapters.find(ch=>ch.number===number);
  if(!chapter?.audioPath) return new NextResponse("الصوت غير جاهز.",{status:404});
  const blob=await get(chapter.audioPath,{access:"private"});
  if(!blob||blob.statusCode!==200) return new NextResponse("الملف غير موجود.",{status:404});
  return new Response(blob.stream,{headers:{"Content-Type":"audio/wav","Content-Disposition":`inline; filename="chapter-${String(number).padStart(4,"0")}.wav"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}
