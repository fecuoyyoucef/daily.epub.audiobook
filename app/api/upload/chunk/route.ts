import { NextRequest,NextResponse } from "next/server";
import { UploadServiceError,saveUploadChunk } from "@/lib/uploads/service";
import { forbiddenOriginResponse,getOwnerForRequest,isSameOriginRequest,unauthorizedResponse } from "@/lib/auth/owner";
export const runtime="nodejs"; export const maxDuration=30;
export async function POST(request:NextRequest){
  const owner=await getOwnerForRequest(request);
  if(!owner) return unauthorizedResponse();
  if(!isSameOriginRequest(request)) return forbiddenOriginResponse();
  try{
    const form=await request.formData(); const file=form.get("chunk");
    const uploadId=String(form.get("uploadId")??""); const index=Number(form.get("index")); const total=Number(form.get("total"));
    if(!(file instanceof File)) return NextResponse.json({error:"جزء الملف مفقود."},{status:400});
    const result=await saveUploadChunk(owner.id,uploadId,index,total,Buffer.from(await file.arrayBuffer()));
    return NextResponse.json(result);
  }catch(error){
    if(error instanceof UploadServiceError) return NextResponse.json({error:error.message},{status:error.status});
    console.error("[upload] Chunk save failed",error instanceof Error?error.name:"UnknownError");
    return NextResponse.json({error:"تعذّر حفظ جزء الملف."},{status:500});
  }
}
