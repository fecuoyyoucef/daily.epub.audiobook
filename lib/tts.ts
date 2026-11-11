const MODEL = "gemini-3.8-flash-lite-tts";
export async function generateArabicSpeech(text: string): Promise<Buffer> {
  const key=process.env.GEMINI_API_KEY; if(!key) throw new Error("GEMINI_API_KEY غير مضبوط في Vercel.");
  const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),240_000);
  try {
    const response=await fetch("https://generativelanguage.googleapis.com/v1beta/interactions",{
      method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},
      body:JSON.stringify({
        model:MODEL,
        input:[{type:"user_input",content:[{type:"text",text,annotations:[{type:"speech_metadata",style:"Natural Arabic audiobook narration in clear Modern Standard Arabic. Read the supplied text verbatim, without summarizing, skipping, or adding commentary. Use measured pacing and restrained expressive delivery."}]}]}],
        response_format:{type:"audio"},
        generation_config:{speech_config:[{voice:"Kore",language:"ar-XA"}]}
      }),signal:controller.signal
    });
    const payload:any=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(String(payload?.error?.message||payload?.message||`Gemini API returned HTTP ${response.status}`).slice(0,500));
    const audioData=payload?.output_audio?.data??payload?.outputAudio?.data;
    if(typeof audioData!=="string"||!audioData.length) throw new Error("وصل رد Gemini من دون بيانات صوتية قابلة للحفظ.");
    return Buffer.from(audioData,"base64");
  } catch(error) {
    if(error instanceof Error&&error.name==="AbortError") throw new Error("تجاوز توليد الصوت مهلة التنفيذ.");
    throw error;
  } finally { clearTimeout(timeout); }
}
