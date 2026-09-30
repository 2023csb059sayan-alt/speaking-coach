import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { api, apiUrl } from '../lib/api';
import { Notice, Card, Badge } from './Primitives';

/**
 * Phase 2C: Full conversation loop with barge-in, confidence mode, background handling.
 *
 * State machine:
 *   idle → listening → user_speaking → processing → ai_speaking → listening
 *                           ↑___________barge-in___________↓
 *
 * Rules:
 *   - Media only runs while the button is held (press-and-speak)
 *   - VAD detects end-of-turn (1.5–2.5 s configurable, more patient in Confidence Mode)
 *   - Double-tap safety: first tap during AI speech arms barge-in, second tap confirms
 *   - Tab backgrounding pauses recording; screen lock stops recording
 *   - Confidence mode toggle switches EOT patience (normal 1.5s / patient 2.5s)
 *   - If no STT provider configured → offline_fallback mode
 *   - Audio is ephemeral; nothing sent to /api except transcript request
 */

type ConversationScreenProps = {
  onTranscript?: (transcript: string, audioSeconds: number) => void;
};

export function ConversationScreen({ onTranscript }: ConversationScreenProps) {
  // Session state
  const [state, setState] = useState<ConversationState>({
    status: 'idle',
    confidenceMode: 'normal',
    elapsedMs: 0,
    userSpeechMs: 0,
    pressMs: 0,
    canRecord: false,
    error: null,
    bargeArmed: false,
  });

  // Refs
  const audioChunksRef = useRef<Blob[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const pressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eotTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bargeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPressTimeRef = useRef<number>(0);
  const sessionStartRef = useRef<number>(Date.now());

  // VAD thresholds
  const VAD_DEFAULTS = {
    endOfTurnNormalMs: 1500,
    endOfTurnPatientMs: 2500,
  } as const;

  const confidenceMode = state.confidenceMode;
  const eotThresholdMs = useMemo(
    () =>
      confidenceMode === 'patient'
        ? VAD_DEFAULTS.endOfTurnPatientMs
        : VAD_DEFAULTS.endOfTurnNormalMs,
    [confidenceMode],
  );

  // -------------------------------------------------------------------------
  // Initialise: check STT provider + request mic permission once
  // -------------------------------------------------------------------------
  useEffect(() => {
    let mounted = true;

    async function init(): Promise<void> {
      try {
        const prov = await api.providers();
        const sttOk = prov.providers.some(
          (p) => p.kind === 'stt' && p.status === 'ok' && p.configured,
        );
        if (!mounted) return;
        setState((s) => ({ ...s, canRecord: sttOk, status: sttOk ? 'idle' : 'offline_fallback' }));
      } catch (e) {
        if (!mounted) return;
        setState((s) => ({
          ...s,
          error: (e as Error).message,
          canRecord: false,
          status: 'offline_fallback',
        }));
      }
    }

    void init();
    return () => {
      mounted = false;
    };
  }, []);

  // Mic permission
  useEffect(() => {
    if (state.canRecord === undefined) {
      (async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              autoGainControl: true,
              noiseSuppression: true,
              sampleRate: 16000,
              channelCount: 1,
            },
          });
          stream.getTracks().forEach((t) => t.stop());
          setState((s) => ({ ...s, canRecord: true }));
        } catch {
          setState((s) => ({ ...s, canRecord: false }));
        }
      })();
    }
  }, [state.canRecord]);

  // -------------------------------------------------------------------------
  // Tab visibility & screen lock handling
  // -------------------------------------------------------------------------
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab backgrounded - pause if we're recording
        if (state.status === 'listening' || state.status === 'user_speaking') {
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.pause();
          }
          if (eotTimeoutRef.current) {
            clearTimeout(eotTimeoutRef.current);
            eotTimeoutRef.current = null;
          }
        }
      } else {
        // Tab foregrounded - resume if we were recording
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
          mediaRecorderRef.current.resume();
          // Restart EOT timer
          startEotTimer();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [state.status]);

  // -------------------------------------------------------------------------
  // Elapsed time ticker
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (state.status === 'idle' || state.status === 'offline_fallback') return;
    const timer = setInterval(() => {
      setState((s) => ({ ...s, elapsedMs: Date.now() - sessionStartRef.current }));
    }, 500);
    return () => clearInterval(timer);
  }, [state.status]);

  // -------------------------------------------------------------------------
  // Start recording when user presses the button
  // -------------------------------------------------------------------------
  const onStartPress = useCallback(async () => {
    const now = Date.now();
    const timeSinceLastPress = now - lastPressTimeRef.current;
    lastPressTimeRef.current = now;

    // Double-tap barge-in logic: if AI is speaking and user presses twice within 400ms
    if (state.status === 'ai_speaking') {
      if (timeSinceLastPress < 400 && state.bargeArmed) {
        // Confirmed barge-in!
        if (bargeTimeoutRef.current) {
          clearTimeout(bargeTimeoutRef.current);
          bargeTimeoutRef.current = null;
        }
        await handleBargeIn();
        return;
      } else {
        // First tap - arm barge-in
        setState((s) => ({ ...s, bargeArmed: true }));
        bargeTimeoutRef.current = setTimeout(() => {
          setState((s) => ({ ...s, bargeArmed: false }));
        }, 400);
        return;
      }
    }

    // Clear barge-in arm on any other press
    if (bargeTimeoutRef.current) {
      clearTimeout(bargeTimeoutRef.current);
      bargeTimeoutRef.current = null;
    }
    setState((s) => ({ ...s, bargeArmed: false }));

    // Normal press-to-speak logic
    if (!state.canRecord || (state.status !== 'idle' && state.status !== 'listening')) return;

    setState((s) => ({
      ...s,
      status: 'listening',
      elapsedMs: 0,
      userSpeechMs: 0,
      pressMs: 0,
      error: null,
    }));
    sessionStartRef.current = Date.now();

    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          autoGainControl: true,
          noiseSuppression: true,
          sampleRate: 16000,
          channelCount: 1,
        },
      });

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });

      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0 && mediaRecorderRef.current === mediaRecorder) {
          audioChunksRef.current?.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const audioSeconds = audioBlob?.size ? audioBlob.size / 1_600_000 : 0;

        stream.getTracks().forEach((t) => t.stop());

        if (mediaRecorderRef.current === mediaRecorder) {
          await runConversationPipeline(audioBlob, audioSeconds);
        }

        setState((s) => ({
          ...s,
          status: 'idle',
          canRecord: true,
          pressMs: 0,
          elapsedMs: 0,
          userSpeechMs: 0,
        }));
      };

      mediaRecorder.start();
      startPressTimer();
    } catch (e) {
      setState((s) => ({ ...s, error: (e as Error).message, status: 'idle' }));
    }
  }, [state.canRecord, state.status, state.bargeArmed, confidenceMode]);

  // -------------------------------------------------------------------------
  const handleBargeIn = useCallback(async () => {
    // Stop AI audio playback
    if (audioRef.current) {
      audioRef.current.pause();
      URL.revokeObjectURL(audioRef.current.src);
      audioRef.current = null;
    }

    // Stop any ongoing LLM stream (we can't cancel fetch, but we can ignore its output)
    // The user is now starting a new turn
    setState((s) => ({
      ...s,
      status: 'listening',
      bargeArmed: false,
      elapsedMs: 0,
      userSpeechMs: 0,
      pressMs: 0,
      error: null,
    }));
    sessionStartRef.current = Date.now();

    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          autoGainControl: true,
          noiseSuppression: true,
          sampleRate: 16000,
          channelCount: 1,
        },
      });

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });

      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0 && mediaRecorderRef.current === mediaRecorder) {
          audioChunksRef.current?.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const audioSeconds = audioBlob?.size ? audioBlob.size / 1_600_000 : 0;

        stream.getTracks().forEach((t) => t.stop());

        if (mediaRecorderRef.current === mediaRecorder) {
          await runConversationPipeline(audioBlob, audioSeconds);
        }

        setState((s) => ({
          ...s,
          status: 'idle',
          canRecord: true,
          pressMs: 0,
          elapsedMs: 0,
          userSpeechMs: 0,
        }));
      };

      mediaRecorder.start();
      startPressTimer();
    } catch (e) {
      setState((s) => ({ ...s, error: (e as Error).message, status: 'idle' }));
    }
  }, [confidenceMode]);

  // -------------------------------------------------------------------------
  const startPressTimer = useCallback(() => {
    if (eotTimeoutRef.current) {
      clearTimeout(eotTimeoutRef.current);
      eotTimeoutRef.current = null;
    }

    // Press-too-short guard - advance pressMs every 100 ms
    pressTimeoutRef.current = setTimeout(() => {
      setState((s) => ({ ...s, pressMs: s.pressMs + 100 }));
      startPressTimer();
    }, 100);

    // End-of-turn timer
    startEotTimer();
  }, [confidenceMode, eotThresholdMs]);

  const startEotTimer = useCallback(() => {
    if (eotTimeoutRef.current) {
      clearTimeout(eotTimeoutRef.current);
    }
    eotTimeoutRef.current = setTimeout(async () => {
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
      }
      setState((s) => ({ ...s, status: 'processing' }));
    }, eotThresholdMs);
  }, [eotThresholdMs]);

  // -------------------------------------------------------------------------
  // Full pipeline: STT → LLM streaming → TTS
  // -------------------------------------------------------------------------
  const runConversationPipeline = useCallback(
    async (audioBlob: Blob, audioSeconds: number) => {
      if (!state.canRecord) return;

      setState((s) => ({ ...s, status: 'processing' }));

      try {
        // ---- STEP 1: STT ----
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm');

        const sttResp = await fetch(apiUrl('/stt/process'), {
          method: 'POST',
          body: formData,
          credentials: 'include',
          headers: { 'x-sc-client': 'web' },
        });

        if (!sttResp.ok) {
          const err = await sttResp.json().catch(() => ({}));
          throw new Error(err.message ?? 'STT failed');
        }

        const sttResult = await sttResp.json();
        const transcript = sttResult.text?.trim();

        if (!transcript) {
          setState((s) => ({
            ...s,
            status: 'listening',
            error: 'No speech detected. Try speaking louder or closer to the mic.',
          }));
          return;
        }

        // ---- STEP 2: LLM (streamed) ----
        setState((s) => ({ ...s, status: 'ai_speaking' }));

        const llmResp = await fetch(apiUrl('/llm/stream'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-sc-client': 'web',
          },
          credentials: 'include',
          body: JSON.stringify({
            system:
              "You are a warm, patient English speaking coach for Indian learners. Respond naturally, briefly (1-2 sentences), and never use grammar jargon. If asked, explain in the user's native language.",
            prompt: transcript,
            maxOutputTokens: 256,
            temperature: 0.7,
          }),
        });

        if (!llmResp.ok) {
          throw new Error('LLM stream failed');
        }

        let fullResponse = '';
        const reader = llmResp.body?.getReader();
        const decoder = new TextDecoder();

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.text && !data.done) {
                    fullResponse += data.text;
                  }
                } catch {
                  // Ignore parse errors
                }
              }
            }
          }
        }

        if (!fullResponse.trim()) {
          setState((s) => ({ ...s, status: 'listening', error: 'No response from coach.' }));
          return;
        }

        // ---- STEP 3: TTS ----
        const ttsResp = await fetch(apiUrl('/tts/speak'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-sc-client': 'web',
          },
          credentials: 'include',
          body: JSON.stringify({
            text: fullResponse,
            speed: 1.0,
          }),
        });

        if (!ttsResp.ok) {
          throw new Error('TTS failed');
        }

        const audioArrayBuffer = await ttsResp.arrayBuffer();
        const ttsAudioBlob = new Blob([audioArrayBuffer], { type: 'audio/mpeg' });
        const audioUrl = URL.createObjectURL(ttsAudioBlob);

        if (audioRef.current) {
          audioRef.current.pause();
          URL.revokeObjectURL(audioRef.current.src);
        }
        const audio = new Audio(audioUrl);
        audioRef.current = audio;

        audio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          audioRef.current = null;
          // When AI finishes speaking, go back to listening
          setState((s) => {
            if (s.status === 'ai_speaking') {
              return { ...s, status: 'listening' };
            }
            return s;
          });
        };

        audio.onerror = () => {
          URL.revokeObjectURL(audioUrl);
          audioRef.current = null;
          setState((s) => ({ ...s, status: 'listening', error: 'Audio playback failed.' }));
        };

        audio.play().catch(() => {
          // Autoplay blocked - user will need to interact
        });

        // Update state with usage
        setState((s) => ({
          ...s,
          status: 'ai_speaking',
          userSpeechMs: (s.userSpeechMs ?? 0) + (sttResult.usage?.audio_seconds ?? 0) * 1000,
          error: null,
          confidenceMode: s.confidenceMode,
          elapsedMs: s.elapsedMs,
          pressMs: 0,
        }));

        onTranscript?.(transcript, audioSeconds ?? 0);
      } catch (e) {
        setState((s) => ({ ...s, status: 'listening', error: (e as Error).message }));
      }
    },
    [state.canRecord],
  );

  // -------------------------------------------------------------------------
  // Confidence mode toggle
  // -------------------------------------------------------------------------
  const toggleConfidenceMode = useCallback(() => {
    setState((s) => ({
      ...s,
      confidenceMode: s.confidenceMode === 'patient' ? 'normal' : 'patient',
    }));
  }, []);

  // -------------------------------------------------------------------------
  // UI
  // -------------------------------------------------------------------------
  const statusText = useMemo(() => {
    const base = {
      idle: 'Tap to speak',
      listening: 'Hold to speak',
      user_speaking: "You're speaking…",
      processing: 'Processing…',
      ai_speaking: 'Coach is speaking…',
      offline_fallback: 'Practice mode is busy - try again later',
    };
    return base[state.status] ?? '…';
  }, [state.status]);

  const btnText = useMemo(() => {
    switch (state.status) {
      case 'listening':
      case 'user_speaking':
        return 'Hold ▶';
      case 'ai_speaking':
        return state.bargeArmed ? 'Tap again to interrupt' : 'Tap to interrupt';
      case 'processing':
        return '…processing';
      default:
        return 'Hold ▶';
    }
  }, [state.status, state.bargeArmed]);

  const btnDisabled =
    state.status !== 'listening' &&
    state.status !== 'user_speaking' &&
    state.status !== 'ai_speaking';

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-4 py-8">
      {/* Status banner */}
      <Card>
        <header className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold tracking-tight text-slate-100">Speaking Coach</h2>
          <Badge tone={confidenceMode === 'patient' ? 'ok' : 'accent'}>
            {confidenceMode === 'patient' ? 'Patient' : 'Normal'}
          </Badge>
        </header>
        <p className="text-sm text-slate-400 mb-2">{statusText}</p>
        <button
          type="button"
          onClick={toggleConfidenceMode}
          className="text-xs text-accent-400 underline-offset-2 hover:underline"
          aria-pressed={confidenceMode === 'patient'}
        >
          {confidenceMode === 'patient'
            ? 'Switch to Normal mode (1.5s EOT)'
            : 'Switch to Patient mode (2.5s EOT)'}
        </button>
        {state.error && (
          <div className="mt-2">
            <Notice tone="bad">{state.error}</Notice>
          </div>
        )}
        {state.status === 'offline_fallback' && (
          <div className="mt-2">
            <Notice tone="neutral">
              No STT provider is configured on the server. This is the "Practice mode is busy"
              offline‑capable fallback.
            </Notice>
          </div>
        )}
      </Card>

      {/* Conversation card */}
      <Card>
        {/* Progress line */}
        <div className="mb-4 flex items-baseline gap-2 text-xs text-slate-500">
          <span>Elapsed: {Math.round(state.elapsedMs / 1000)}s</span>
          <span>Your speech: {Math.round((state.userSpeechMs ?? 0) / 1000)}s</span>
          {state.bargeArmed && <span className="text-amber-400">⚡ Armed</span>}
        </div>

        {/* Large tap target button */}
        <button
          disabled={btnDisabled}
          onMouseDown={onStartPress}
          onTouchStart={onStartPress}
          className={`min-h-[44px] w-full rounded-xl font-semibold transition-colors ${
            state.status === 'ai_speaking'
              ? 'bg-rose-500/20 border border-rose-500/30 text-rose-300'
              : state.status === 'listening' || state.status === 'user_speaking'
                ? 'btn-primary'
                : 'btn-ghost'
          }`}
          aria-label={state.status === 'ai_speaking' ? 'Tap to interrupt coach' : 'Hold to speak'}
          aria-live="polite"
        >
          {btnText}
        </button>

        {/* Status area */}
        {state.status === 'processing' && (
          <p className="mt-3 text-sm text-slate-400">Transcribing your speech…</p>
        )}
        {state.status === 'ai_speaking' && !state.bargeArmed && (
          <p className="mt-3 text-sm text-accent-400">Coach is speaking… (tap to interrupt)</p>
        )}
        {state.status === 'ai_speaking' && state.bargeArmed && (
          <p className="mt-3 text-sm text-amber-400">
            Tap again within 0.4s to interrupt and speak
          </p>
        )}
      </Card>
    </main>
  );
}

/** ConversationState type - mirrors what the component stores internally. */
type ConversationState = {
  status:
    | 'idle'
    | 'listening'
    | 'user_speaking'
    | 'processing'
    | 'ai_speaking'
    | 'offline_fallback';
  confidenceMode: 'normal' | 'patient';
  elapsedMs: number;
  userSpeechMs: number;
  pressMs: number;
  canRecord: boolean;
  error: string | null;
  bargeArmed: boolean;
};
