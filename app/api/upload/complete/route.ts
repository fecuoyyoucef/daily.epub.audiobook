import { NextRequest,NextResponse } from "next/server";
import { forbiddenOriginResponse,getOwnerForRequest,isSameOriginRequest,unauthorizedResponse } from "@/lib/auth/owner";
import { finalizeUpload,UploadServiceError } from "@/lib/uploads/service";
export const runtime="nodejs";
export const maxDuration=60;
export async function POST(request:NextRequest){
  const owner=await getOwnerForRequest(request);
  if(!owner) return unauthorizedResponse();
  if(!isSameOriginRequest(request)) return forbiddenOriginResponse();
  let body:any;
  try{body=await request.json();}catch{return NextResponse.json({error:"بيانات الرفع غير صالحة."},{status:400});}
  try{
    const result=await finalizeUpload(owner.id,String(body.uploadId??""));
    return NextResponse.json(result,{status:202});
  }catch(error){
    if(error instanceof UploadServiceError) return NextResponse.json({error:error.message},{status:error.status});
    console.error("[upload] Finalization failed",error instanceof Error?error.name:"UnknownError");
    return NextResponse.json({error:"تعذّر إكمال رفع الكتاب. حاول مرة أخرى."},{status:500});
  }
}
