import { NextRequest,NextResponse } from "next/server";
import { processDailyBatch } from "@/lib/worker";
export const runtime="nodejs"; export const maxDuration=300;
export async function GET(request:NextRequest){
  const secret=process.env.CRON_SECRET;
  if(!secret||request.headers.get("authorization")!==`Bearer ${secret}`) return NextResponse.json({error:"Unauthorized"},{status:401});
  try{return NextResponse.json(await processDailyBatch());}
  catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Worker failed"},{status:500});}
}
