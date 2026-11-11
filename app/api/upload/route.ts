import { NextResponse } from "next/server";
export const runtime="nodejs";
export async function POST(){return NextResponse.json({error:"يستخدم رفع الكتب النقل المجزأ لدعم الملفات حتى 15 MB. حدّث الصفحة وحاول مجدداً."},{status:410});}
