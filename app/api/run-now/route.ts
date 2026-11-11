import { NextResponse } from "next/server";
import { processDailyBatch } from "@/lib/worker";
export const runtime="nodejs"; export const maxDuration=300;
export async function POST(){
  try{return NextResponse.json(await processDailyBatch());}
  catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Worker failed"},{status:500});}
}
