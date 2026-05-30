'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Play, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAgentEditor } from '../agent-editor-context';
import { FormSection } from '../form-section';
import { useVoices, usePreviewVoice } from '@/hooks/use-voices';
import type {
  VoiceConfigDto,
  TtsProviderEnum,
  SupportedLanguageEnum,
} from '@repo/validation';

const STT_PROVIDERS = [
  { value: '', label: 'Auto (recommended)' },
  { value: 'sarvam', label: 'Sarvam AI' },
  { value: 'deepgram', label: 'Deepgram' },
  { value: 'elevenlabs', label: 'ElevenLabs' },
];

const TTS_PROVIDERS: { value: TtsProviderEnum; label: string }[] = [
  { value: 'elevenlabs', label: 'ElevenLabs' },
  { value: 'sarvam', label: 'Sarvam AI' },
];

const DEFAULT_VOICE_CONFIG: VoiceConfigDto = {
  sttEnabled: true,
  ttsEnabled: true,
  ttsProvider: 'elevenlabs',
  defaultLanguage: 'en',
  supportedLanguages: ['en'],
  // ttsSpeed kept at the schema default (1.0) — UI control is removed but the field
  // still flows through to providers, so leaving it set ensures consistent behaviour.
  ttsSpeed: 1.0,
  autoDetectLanguage: true,
};

const PROVIDER_LABEL: Record<TtsProviderEnum, string> = {
  elevenlabs: 'ElevenLabs',
  sarvam: 'Sarvam AI',
};

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return arr.buffer;
}

const NONE_VALUE = '__provider_default__';

/** Small UX delay between the audio being ready and playback actually starting. Avoids
 *  the jarring "click → instant audio" feel. */
const PLAYBACK_LEAD_IN_S = 0.2;

/** Length of the silent primer buffer we play immediately on click. The OS audio output
 *  can take 200-500ms to wake from idle; without priming, those samples are dropped and
 *  we lose the start of our real audio. The primer plays in parallel with the network
 *  request, so by the time the real clip is ready, the speakers are already streaming
 *  (silent) samples and ready for content. 1.5s comfortably covers slow network calls. */
const SILENT_PRIMER_S = 1.5;

/** Play a silent buffer to wake the OS audio output. Cheap, ~no perceptible cost. */
function primeAudioOutput(ctx: AudioContext): void {
  const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * SILENT_PRIMER_S)), ctx.sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(0);
}

interface VoicePickerProps {
  value: string | undefined;
  onChange: (voiceId: string | undefined) => void;
  preferredProvider?: TtsProviderEnum;
  previewLanguage: SupportedLanguageEnum;
}

function VoicePicker({ value, onChange, preferredProvider, previewLanguage }: VoicePickerProps) {
  const { data, isLoading, isError } = useVoices();
  const previewVoice = usePreviewVoice();

  // Web Audio API instead of <audio> + Blob URL: cleaner play/stop control, and
  // decodeAudioData decodes the WAV into PCM up front so start(0) plays sample 0
  // cleanly. The backend returns WAV (not MP3) for previews specifically to dodge
  // MP3's mandatory ~24-45ms leading priming silence — that's the *real* fix for the
  // "first word clipped" bug. See voice.service.ts → previewVoice → synthesizePreview.
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'playing'>('idle');

  const stop = () => {
    if (sourceRef.current) {
      sourceRef.current.onended = null;
      try {
        sourceRef.current.stop();
      } catch {
        // already stopped — ignore
      }
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    setPreviewState('idle');
  };

  // Stop any in-flight audio + release the AudioContext when the component unmounts
  useEffect(() => {
    return () => {
      if (sourceRef.current) {
        sourceRef.current.onended = null;
        try {
          sourceRef.current.stop();
        } catch {
          // ignore
        }
        sourceRef.current.disconnect();
      }
      audioContextRef.current?.close().catch(() => undefined);
    };
  }, []);

  const groups = useMemo(() => {
    if (!data) return [];
    return preferredProvider
      ? data.providers.filter((p) => p.provider === preferredProvider)
      : data.providers;
  }, [data, preferredProvider]);

  const selectedVoice = useMemo(() => {
    if (!value || !data) return undefined;
    for (const p of data.providers) {
      const v = p.voices.find((voice) => voice.id === value);
      if (v) return { ...v, provider: p.provider };
    }
    return undefined;
  }, [value, data]);

  // If the selected voice belongs to a hidden provider (e.g., user just switched ttsProvider),
  // fall back to the placeholder rather than confusing the trigger.
  const triggerValue =
    selectedVoice && (!preferredProvider || selectedVoice.provider === preferredProvider)
      ? value
      : undefined;

  const handlePlay = async () => {
    if (!selectedVoice) return;
    if (previewState === 'playing') {
      stop();
      return;
    }
    stop();
    setPreviewState('loading');

    try {
      // Lazily create / reuse the AudioContext. Browsers gate AudioContext on a user
      // gesture; we're inside a click handler so it's fine. resume() may need to be
      // awaited even when not strictly suspended — hardware can take a tick to come up.
      const ctx = audioContextRef.current ?? new AudioContext();
      audioContextRef.current = ctx;
      if (ctx.state !== 'running') {
        await ctx.resume().catch(() => undefined);
      }

      // Wake the OS audio output BEFORE the network call so the speakers are streaming
      // silent samples by the time the real audio is decoded. Without this, the OS
      // power-saves the audio path after ~1s idle and the first ~200ms of real audio
      // gets dropped while the device wakes (Intel Community thread #1627430). The
      // primer is just silence — no perceptible cost, no audible artifact.
      primeAudioOutput(ctx);

      // Always synthesize through our preview endpoint so every voice introduces itself
      // ("Hello, my name is X..."). Provider preview URLs would speak generic vendor copy.
      const result = await previewVoice({
        provider: selectedVoice.provider,
        voiceId: selectedVoice.id,
        language: previewLanguage,
      });

      const arrayBuffer = base64ToArrayBuffer(result.audio);
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.onended = stop;
      sourceRef.current = source;
      // Schedule a small delay between "decoded" and "speaking" — feels less jarring than
      // an instant start, and gives the OS audio output a moment to settle on first play.
      source.start(ctx.currentTime + PLAYBACK_LEAD_IN_S);
      setPreviewState('playing');
    } catch {
      stop();
    }
  };

  const placeholder = isLoading
    ? 'Loading voices…'
    : isError
      ? 'Could not load voices'
      : 'Use provider default';

  return (
    <div className="flex gap-2">
      <Select
        value={triggerValue ?? NONE_VALUE}
        onValueChange={(v) => {
          stop();
          onChange(v === NONE_VALUE ? undefined : v);
        }}
        disabled={isLoading}
      >
        <SelectTrigger className="flex-1">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_VALUE}>Use provider default</SelectItem>
          {groups.map((g) => (
            <SelectGroup key={g.provider}>
              <SelectLabel>{PROVIDER_LABEL[g.provider]}</SelectLabel>
              {g.voices.map((v) => {
                const meta = [v.gender, v.category].filter(Boolean).join(' · ');
                return (
                  <SelectItem key={`${g.provider}:${v.id}`} value={v.id}>
                    <span>{v.name}</span>
                    {meta && (
                      <span className="ml-2 text-xs text-muted-foreground">{meta}</span>
                    )}
                  </SelectItem>
                );
              })}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={handlePlay}
        disabled={!selectedVoice || previewState === 'loading'}
        aria-label={previewState === 'playing' ? 'Stop preview' : 'Play voice preview'}
        title={previewState === 'playing' ? 'Stop preview' : 'Play voice preview'}
      >
        {previewState === 'loading' ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : previewState === 'playing' ? (
          <Square className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}

export function VoiceSettings() {
  const { formData, updateFormData } = useAgentEditor();

  const voiceEnabled = formData.voiceEnabled;
  const config = formData.voiceConfig ?? DEFAULT_VOICE_CONFIG;

  const updateConfig = (updates: Partial<VoiceConfigDto>) => {
    updateFormData('voiceConfig', { ...config, ...updates });
  };

  const handleVoiceToggle = (checked: boolean) => {
    updateFormData('voiceEnabled', checked);
    // Apply defaults when enabling for the first time
    if (checked && !formData.voiceConfig) {
      updateFormData('voiceConfig', { ...DEFAULT_VOICE_CONFIG });
    }
  };

  return (
    <FormSection
      title="Voice Configuration"
      description="Enable voice input and output for this agent"
    >
      {/* Master toggle */}
      <div className="flex items-center justify-between rounded-lg border p-4">
        <div>
          <Label className="text-sm font-medium">Enable Voice</Label>
          <p className="text-xs text-muted-foreground">
            Allow users to interact with this agent using voice
          </p>
        </div>
        <Switch
          checked={voiceEnabled}
          onCheckedChange={handleVoiceToggle}
        />
      </div>

      {voiceEnabled && (
        <>
          {/* STT Section */}
          <div className="space-y-4 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">Voice Input (STT)</Label>
                <p className="text-xs text-muted-foreground">
                  Enable Speech-to-Text
                </p>
              </div>
              <Switch
                checked={config.sttEnabled}
                onCheckedChange={(checked) => updateConfig({ sttEnabled: checked })}
              />
            </div>

            {config.sttEnabled && (
              <div className="space-y-2">
                <Label className="text-sm">STT Provider</Label>
                <Select
                  value={config.sttProvider ?? '__auto__'}
                  onValueChange={(value) =>
                    updateConfig({
                      sttProvider: value === '__auto__' ? undefined : (value as VoiceConfigDto['sttProvider']),
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Auto (recommended)" />
                  </SelectTrigger>
                  <SelectContent>
                    {STT_PROVIDERS.map((p) => (
                      <SelectItem key={p.value} value={p.value || '__auto__'}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* TTS Section */}
          <div className="space-y-4 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">Voice Output (TTS)</Label>
                <p className="text-xs text-muted-foreground">
                  Enable Text-to-Speech
                </p>
              </div>
              <Switch
                checked={config.ttsEnabled}
                onCheckedChange={(checked) => updateConfig({ ttsEnabled: checked })}
              />
            </div>

            {config.ttsEnabled && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-sm">TTS Provider</Label>
                  <Select
                    value={config.ttsProvider ?? 'elevenlabs'}
                    onValueChange={(value) => {
                      const provider = value as TtsProviderEnum;
                      // Switching providers invalidates the previously selected voice id
                      // (each provider has its own catalog of voice ids).
                      updateConfig({ ttsProvider: provider, ttsVoiceId: undefined });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TTS_PROVIDERS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">Voice</Label>
                  <VoicePicker
                    value={config.ttsVoiceId}
                    onChange={(voiceId) => updateConfig({ ttsVoiceId: voiceId })}
                    preferredProvider={config.ttsProvider}
                    // Preview always plays in English. Production conversations auto-detect
                    // language from each user's audio (no defaultLanguage hint sent).
                    previewLanguage="en"
                  />
                </div>

              </div>
            )}
          </div>

        </>
      )}
    </FormSection>
  );
}
