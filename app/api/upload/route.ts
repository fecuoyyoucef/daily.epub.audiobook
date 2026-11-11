import { NextResponse } from "next/server";
import { forbiddenOriginResponse,getOwnerForRequest,isSameOriginRequest,unauthorizedResponse } from "@/lib/auth/owner";
import { createUploadForOwner,UploadServiceError } from "@/lib/uploads/service";
export const runtime="nodejs";
export async function POST(request:Request){
  const owner=await getOwnerForRequest(request);
  if(!owner) return unauthorizedResponse();
  if(!isSameOriginRequest(request)) return forbiddenOriginResponse();
  let body:any;
  try{body=await request.json();}catch{return NextResponse.json({error:"بيانات الرفع غير صالحة."},{status:400});}
  try{
    const upload=await createUploadForOwner(owner.id,{
      fileName:typeof body.fileName==="string"?body.fileName:"",
      fileSize:Number(body.fileSize),
      totalParts:Number(body.totalParts),
      rightsConfirmation:body.rightsConfirmation===true,
      replace:body.replace===true,
      idempotencyKey:typeof body.idempotencyKey==="string"?body.idempotencyKey:undefined,
    });
    return NextResponse.json({ok:true,uploadId:upload.id,totalParts:upload.chunkCount},{status:201});
  }catch(error){
    if(error instanceof UploadServiceError) return NextResponse.json({error:error.message},{status:error.status});
    console.error("[upload] Initialization failed",error instanceof Error?error.name:"UnknownError");
    return NextResponse.json({error:"تعذّر بدء الرفع. حاول مرة أخرى."},{status:500});
  }
}
