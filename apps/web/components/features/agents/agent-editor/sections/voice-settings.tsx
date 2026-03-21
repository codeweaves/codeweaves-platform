'use client';

import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAgentEditor } from '../agent-editor-context';
import { FormSection } from '../form-section';
import type { VoiceConfigDto } from '@repo/validation';

const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'mr', label: 'Marathi' },
  { value: 'hinglish', label: 'Hinglish' },
] as const;

const STT_PROVIDERS = [
  { value: '', label: 'Auto (recommended)' },
  { value: 'sarvam', label: 'Sarvam AI' },
  { value: 'deepgram', label: 'Deepgram' },
  { value: 'elevenlabs', label: 'ElevenLabs' },
];

const TTS_PROVIDERS = [
  { value: '', label: 'Auto (recommended)' },
  { value: 'sarvam', label: 'Sarvam AI' },
  { value: 'elevenlabs', label: 'ElevenLabs' },
];

const DEFAULT_VOICE_CONFIG: VoiceConfigDto = {
  sttEnabled: true,
  ttsEnabled: true,
  defaultLanguage: 'en',
  supportedLanguages: ['en'],
  ttsSpeed: 1.0,
  autoDetectLanguage: true,
};

function getTtsVoiceIdPlaceholder(provider?: string): string {
  switch (provider) {
    case 'sarvam':
      return 'e.g., Anushka';
    case 'elevenlabs':
      return 'e.g., Xb7hH8MSUJpSbSDYk0k2';
    default:
      return 'e.g., voice identifier';
  }
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

  const addLanguage = (lang: string) => {
    const supported = config.supportedLanguages ?? [];
    if (!supported.includes(lang as VoiceConfigDto['defaultLanguage'])) {
      updateConfig({
        supportedLanguages: [...supported, lang as VoiceConfigDto['defaultLanguage']],
      });
    }
  };

  const removeLanguage = (lang: string) => {
    const supported = config.supportedLanguages ?? [];
    // Don't allow removing the default language
    if (lang === config.defaultLanguage) return;
    updateConfig({
      supportedLanguages: supported.filter((l) => l !== lang),
    });
  };

  const availableLanguages = LANGUAGE_OPTIONS.filter(
    (l) => !(config.supportedLanguages ?? []).includes(l.value as VoiceConfigDto['defaultLanguage']),
  );

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
                    value={config.ttsProvider ?? '__auto__'}
                    onValueChange={(value) =>
                      updateConfig({
                        ttsProvider: value === '__auto__' ? undefined : (value as VoiceConfigDto['ttsProvider']),
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Auto (recommended)" />
                    </SelectTrigger>
                    <SelectContent>
                      {TTS_PROVIDERS.map((p) => (
                        <SelectItem key={p.value} value={p.value || '__auto__'}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">Voice ID</Label>
                  <Input
                    value={config.ttsVoiceId ?? ''}
                    onChange={(e) => updateConfig({ ttsVoiceId: e.target.value || undefined })}
                    placeholder={getTtsVoiceIdPlaceholder(config.ttsProvider)}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Speech Speed</Label>
                    <span className="text-sm text-muted-foreground">
                      {(config.ttsSpeed ?? 1.0).toFixed(1)}x
                    </span>
                  </div>
                  <Slider
                    value={[config.ttsSpeed ?? 1.0]}
                    onValueChange={([value]) => {
                      if (value !== undefined) updateConfig({ ttsSpeed: Math.round(value * 10) / 10 });
                    }}
                    min={0.5}
                    max={2.0}
                    step={0.1}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Language Section */}
          <div className="space-y-4 rounded-lg border p-4">
            <Label className="text-sm font-medium">Language</Label>

            <div className="space-y-2">
              <Label className="text-sm">Default Language</Label>
              <Select
                value={config.defaultLanguage ?? 'en'}
                onValueChange={(value) => {
                  const lang = value as VoiceConfigDto['defaultLanguage'];
                  const supported = config.supportedLanguages ?? [];
                  const updates: Partial<VoiceConfigDto> = { defaultLanguage: lang };
                  // Ensure default language is in supported list
                  if (!supported.includes(lang)) {
                    updates.supportedLanguages = [...supported, lang];
                  }
                  updateConfig(updates);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGE_OPTIONS.map((lang) => (
                    <SelectItem key={lang.value} value={lang.value}>
                      {lang.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm">Supported Languages</Label>
              <div className="flex flex-wrap gap-2">
                {(config.supportedLanguages ?? []).map((lang) => {
                  const langOption = LANGUAGE_OPTIONS.find((l) => l.value === lang);
                  return (
                    <Badge key={lang} variant="secondary" className="gap-1">
                      {langOption?.label ?? lang}
                      {lang !== config.defaultLanguage && (
                        <button
                          type="button"
                          onClick={() => removeLanguage(lang)}
                          className="ml-1 rounded-full hover:bg-muted-foreground/20"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </Badge>
                  );
                })}
              </div>
              {availableLanguages.length > 0 && (
                <Select
                  key={config.supportedLanguages?.length ?? 0}
                  onValueChange={addLanguage}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Add language..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableLanguages.map((lang) => (
                      <SelectItem key={lang.value} value={lang.value}>
                        {lang.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Auto-detect Language</Label>
                <p className="text-xs text-muted-foreground">
                  Automatically detect the user&apos;s language from their speech
                </p>
              </div>
              <Switch
                checked={config.autoDetectLanguage}
                onCheckedChange={(checked) => updateConfig({ autoDetectLanguage: checked })}
              />
            </div>
          </div>
        </>
      )}
    </FormSection>
  );
}
