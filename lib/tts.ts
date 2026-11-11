import 'server-only'

export const GEMINI_TTS_MODEL = 'gemini-3.8-flash-lite-tts'

export type TtsFailureKind = 'configuration' | 'invalid_request' | 'rate_limited' | 'ambiguous'

export class TtsGenerationError extends Error {
  constructor(
    message: string,
    public readonly kind: TtsFailureKind,
    public readonly status?: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'TtsGenerationError'
  }
}

export async function generateArabicSpeech(text: string): Promise<Buffer> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new TtsGenerationError('Gemini is not configured.', 'configuration')
  if (!text.trim() || text.length > 4000) {
    throw new TtsGenerationError('The audio part is outside the supported input range.', 'invalid_request')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 240_000)

  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        model: GEMINI_TTS_MODEL,
        input: [{
          type: 'user_input',
          content: [{
            type: 'text',
            text,
            annotations: [{
              type: 'speech_metadata',
              style: 'Natural Arabic audiobook narration in clear Modern Standard Arabic. Read the supplied text verbatim, without summarizing, skipping, or adding commentary. Use measured pacing and restrained expressive delivery.',
            }],
          }],
        }],
        response_format: { type: 'audio' },
        generation_config: { speech_config: [{ voice: 'Kore', language: 'ar-XA' }] },
      }),
      signal: controller.signal,
    })

    if (response.status === 429) {
      const rawRetryAfter = Number(response.headers.get('retry-after'))
      const retryAfterMs = Number.isFinite(rawRetryAfter)
        ? Math.min(Math.max(rawRetryAfter * 1000, 1000), 120_000)
        : 60_000
      throw new TtsGenerationError('Gemini rate limited the request.', 'rate_limited', 429, retryAfterMs)
    }
    if (response.status === 401 || response.status === 403) {
      throw new TtsGenerationError('Gemini credentials were rejected.', 'configuration', response.status)
    }
    if (response.status >= 400 && response.status < 500) {
      throw new TtsGenerationError('Gemini rejected the audio request.', 'invalid_request', response.status)
    }
    if (!response.ok) {
      throw new TtsGenerationError('Gemini returned an uncertain provider response.', 'ambiguous', response.status)
    }

    let payload: { output_audio?: { data?: unknown }; outputAudio?: { data?: unknown } }
    try {
      payload = await response.json() as typeof payload
    } catch {
      throw new TtsGenerationError('Gemini returned an unreadable audio response.', 'ambiguous', response.status)
    }

    const audioData = payload?.output_audio?.data ?? payload?.outputAudio?.data
    if (typeof audioData !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(audioData) || audioData.length % 4 !== 0) {
      throw new TtsGenerationError('Gemini returned no valid audio payload.', 'ambiguous', response.status)
    }

    const audio = Buffer.from(audioData, 'base64')
    if (!audio.length || audio.length > 25 * 1024 * 1024) {
      throw new TtsGenerationError('Gemini returned audio outside the supported size range.', 'ambiguous', response.status)
    }
    return audio
  } catch (error) {
    if (error instanceof TtsGenerationError) throw error
    throw new TtsGenerationError(
      error instanceof Error && error.name === 'AbortError'
        ? 'Gemini audio generation timed out.'
        : 'The Gemini audio request outcome is unknown.',
      'ambiguous',
    )
  } finally {
    clearTimeout(timeout)
  }
}
