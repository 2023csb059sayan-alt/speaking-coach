import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { apiRateLimit } from '../middleware/security';
import { requireClientHeader } from '../middleware/auth';
import { orderedLlmProviders, orderedSttProviders, orderedTtsProviders } from '../providers/registry';
import { logger } from '../logging';
import type { STTResult, TTSResult } from '../providers/types';

/**
 * Voice routes: STT, LLM streaming, TTS.
 *
 * All routes are protected by the apiRateLimit and require the x-sc-client header.
 * The Quota Governor (runWithFallback) handles provider selection, fallback,
 * circuit breaking, and budget accounting.
 */

export const voiceRouter = Router();

voiceRouter.use(requireClientHeader);
voiceRouter.use(apiRateLimit);

/**
 * POST /api/stt/process
 * Accepts multipart/form-data with field "audio" (Blob).
 * Returns: { text, words: WordTiming[], segments: SegmentTiming[], language, audioDurationMs, usage }
 */
voiceRouter.post(
  '/stt/process',
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: { code: 'bad_request', message: 'Missing audio file' } });
    }

    const start = Date.now();
    const audioBuffer = file.buffer;
    const contentType = file.mimetype;

    // Run through the STT chain with conversation priority
    const sttProviders = orderedSttProviders();
    if (sttProviders.length === 0) {
      return res.status(503).json({ error: { code: 'no_stt_provider', message: 'No STT provider configured' } });
    }

    let result: STTResult | null = null;
    let lastError: Error | null = null;

    for (const provider of sttProviders) {
      if (!provider.isConfigured()) continue;
      try {
        result = await provider.transcribe({
          audio: audioBuffer,
          contentType,
          language: req.body.language || 'en',
          prompt: req.body.prompt,
          purpose: 'conversation',
        });
        break;
      } catch (e) {
        lastError = e as Error;
        logger.warn({ provider: provider.id, err: (e as Error).message }, 'STT provider failed, trying next');
        continue;
      }
    }

    if (!result) {
      return res.status(503).json({
        error: { code: 'stt_unavailable', message: lastError?.message ?? 'All STT providers failed' },
      });
    }

    const latencyMs = Date.now() - start;
    logger.info({ providerId: result.providerId, textLength: result.text.length, latencyMs }, 'STT completed');

    res.json({
      text: result.text,
      words: result.words,
      segments: result.segments,
      language: result.language,
      audioDurationMs: result.audioDurationMs,
      usage: {
        audio_seconds: Math.round((result.audioDurationMs ?? 0) / 1000),
      },
      providerId: result.providerId,
      latencyMs,
    });
  }),
);

/**
 * POST /api/llm/stream
 * Body: { system: string, prompt: string, maxOutputTokens?: number, temperature?: number }
 * Returns: Server-Sent Events stream with chunks { text: string, done: boolean }
 */
voiceRouter.post(
  '/llm/stream',
  asyncHandler(async (req, res) => {
    const body = llmStreamSchema.parse(req.body);

    const llmProviders = orderedLlmProviders();
    if (llmProviders.length === 0) {
      return res.status(503).json({ error: { code: 'no_llm_provider', message: 'No LLM provider configured' } });
    }

    // SSE setup
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const sendEvent = (data: object) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const closeStream = () => {
      sendEvent({ text: '', done: true });
      res.end();
    };

    let lastError: Error | null = null;
    let success = false;

    for (const provider of llmProviders) {
      if (!provider.isConfigured()) continue;
      try {
        // The provider's complete method returns full text; we stream it in chunks
        // For true streaming, the provider would need a streamComplete method.
        // For now we simulate streaming by chunking the response.
        const response = await provider.complete({
          system: body.system,
          prompt: body.prompt,
          maxOutputTokens: body.maxOutputTokens ?? 512,
          temperature: body.temperature ?? 0.7,
          purpose: 'conversation',
        });

        // Stream the response in word chunks
        const words = response.text.split(/(\s+)/);
        for (const word of words) {
          if (res.destroyed) return;
          sendEvent({ text: word, done: false });
          await new Promise((r) => setTimeout(r, 30)); // small delay for streaming effect
        }

        sendEvent({
          text: '',
          done: true,
          usage: {
            inputTokens: response.inputTokens,
            outputTokens: response.outputTokens,
          },
          providerId: response.providerId,
          latencyMs: response.latencyMs,
        });
        success = true;
        break;
      } catch (e) {
        lastError = e as Error;
        logger.warn({ provider: provider.id, err: (e as Error).message }, 'LLM provider failed, trying next');
        continue;
      }
    }

    if (!success) {
      logger.error({ err: lastError?.message }, 'All LLM providers failed');
      sendEvent({ text: '', done: true, error: lastError?.message ?? 'All LLM providers failed' });
      return closeStream();
    }

    closeStream();
  }),
);

/**
 * POST /api/tts/speak
 * Body: { text: string, voice?: string }
 * Returns: audio/mpeg (or audio/wav) binary
 */
voiceRouter.post(
  '/tts/speak',
  asyncHandler(async (req, res) => {
    const body = ttsSchema.parse(req.body);

    const ttsProviders = orderedTtsProviders();
    if (ttsProviders.length === 0) {
      return res.status(503).json({ error: { code: 'no_tts_provider', message: 'No TTS provider configured' } });
    }

    let result: TTSResult | null = null;
    let lastError: Error | null = null;

    for (const provider of ttsProviders) {
      if (!provider.isConfigured()) continue;
      try {
        result = await provider.synthesize({
          text: body.text,
          voice: body.voice,
          format: 'mp3',
          speed: body.speed ?? 1.0,
          purpose: 'conversation',
        });
        break;
      } catch (e) {
        lastError = e as Error;
        logger.warn({ provider: provider.id, err: (e as Error).message }, 'TTS provider failed, trying next');
        continue;
      }
    }

    if (!result) {
      return res.status(503).json({
        error: { code: 'tts_unavailable', message: lastError?.message ?? 'All TTS providers failed' },
      });
    }

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Length', result.bytes.toString());
    res.setHeader('X-Provider-Id', result.providerId);
    res.setHeader('X-Latency-Ms', result.latencyMs.toString());
    res.send(result.audio);
  }),
);

/** Validation schemas */
const llmStreamSchema = z.object({
  system: z.string().min(1).max(4000),
  prompt: z.string().min(1).max(8000),
  maxOutputTokens: z.number().int().positive().max(2048).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

const ttsSchema = z.object({
  text: z.string().min(1).max(5000),
  voice: z.string().optional(),
  speed: z.number().min(0.5).max(2.0).optional(),
});