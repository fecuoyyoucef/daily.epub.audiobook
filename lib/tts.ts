import 'server-only'

import { APICallError, generateSpeech } from 'ai'
import { gateway } from '@ai-sdk/gateway'

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
  if (!text.trim() || text.length > 4000) {
    throw new TtsGenerationError('The audio part is outside the supported input range.', 'invalid_request')
  }

  try {
    const result = await generateSpeech({
      model: gateway.speechModel(`google/${GEMINI_TTS_MODEL}`),
      text,
      voice: 'Kore',
      language: 'ar-XA',
      instructions: 'Natural Arabic audiobook narration in clear Modern Standard Arabic. Read the supplied text verbatim, without summarizing, skipping, or adding commentary. Use measured pacing and restrained expressive delivery.',
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(240_000),
    })

    const audio = Buffer.from(result.audio.uint8Array)
    if (!audio.length) throw new TtsGenerationError('Gemini returned no audio payload.', 'ambiguous')
    return audio
  } catch (error) {
    if (error instanceof TtsGenerationError) throw error

    const status = APICallError.isInstance(error) ? error.statusCode : undefined
    if (status === 429) {
      throw new TtsGenerationError('The speech provider is rate limiting requests.', 'rate_limited', status, 60_000)
    }
    if (status === 401 || status === 403) {
      throw new TtsGenerationError('AI Gateway credentials were rejected.', 'configuration', status)
    }
    if (status !== undefined && status >= 400 && status < 500) {
      throw new TtsGenerationError('The speech provider rejected the audio request.', 'invalid_request', status)
    }

    throw new TtsGenerationError(
      error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)
        ? 'Speech generation timed out.'
        : 'The speech request result could not be confirmed.',
      'ambiguous',
      status,
    )
  }
}
