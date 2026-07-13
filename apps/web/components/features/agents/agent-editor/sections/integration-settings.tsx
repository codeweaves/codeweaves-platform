'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { X, Plus, Zap, Webhook } from 'lucide-react';
import { useAgentEditor } from '../agent-editor-context';
import { useProfile } from '@/hooks/use-profile';
import type { AgentAiConfigDto } from '@repo/validation';

function normalizeDomain(s: string) {
  return s
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*/, '')
    .replace(/\/$/, '');
}

function isValidDomain(s: string) {
  return /^(localhost(?::\d+)?|\d+\.\d+\.\d+\.\d+|[a-z0-9.-]+(?::\d+)?)$/.test(s);
}

/**
 * Curated list of model IDs that ship pre-configured. The backend happily
 * accepts any valid provider-prefixed ID (see parseModelId), so we also
 * expose a "Custom" option that swaps in a free-text input — lets power
 * users target any new model the day it ships on OpenRouter.
 */
interface ModelOption {
  value: string;
  label: string;
  hint: string;
}

// Curated model shortlist — the five we've benchmarked and proven for
// production use (see docs/plans/latency-tests.md). Trimmed from the longer
// historical list; admins can still type any model via the "Custom" option.
//
// Selection criteria:
//   - gpt-4.1 / gpt-4.1-mini: OpenAI quality benchmark + auto prompt caching
//     (24h retention) for cost win. Mini is the recommended default.
//   - gemini-2.5-flash: cheapest non-disqualified option, 1M context, free at
//     low scale. Strong for multilingual.
//   - qwen3-32b on Groq: sub-200ms TTFT from India, strong multilingual.
//     Watch the free-tier RPM cap (60/min). Paid Groq tier removes the cap.
//   - Claude Haiku 4.5: fastest TTFT in published benchmarks (~597ms median).
//     New addition pending integration testing.
const CURATED_MODELS: ModelOption[] = [
  { value: 'openai:gpt-4.1', label: 'GPT-4.1 (OpenAI)', hint: 'Best instruction-following — obeys strict rules like character-limit caps reliably. Auto prompt-caching with 24h retention configured. Higher cost per token but premium quality.' },
  { value: 'openai:gpt-4.1-mini', label: 'GPT-4.1 mini (OpenAI)', hint: 'Balanced quality/speed, auto prompt-caching (24h retention). 10× cheaper than gpt-4.1 with comparable quality. Recommended default.' },
  { value: 'gemini:gemini-2.5-flash', label: 'Gemini 2.5 Flash (Google)', hint: '1M context window, thinking disabled for low latency. Free tier covers 1500 req/day. Strong multilingual + cheapest paid tier among quality models.' },
  { value: 'groq:qwen/qwen3-32b', label: 'Qwen 3 32B (Groq)', hint: 'Strong multilingual (29+ languages). Measured ~156ms TTFT from India. Free tier: 60 RPM / 500K TPD — production-ready once on paid plan. Currently free during preview.' },
  { value: 'anthropic/claude-haiku-4-5', label: 'Claude Haiku 4.5 (Anthropic)', hint: 'Fastest published TTFT in 2026 benchmarks (~597ms median). New addition — pending production testing in this codebase.' },
];

export function IntegrationSettings() {
  const { profile } = useProfile();
  const { formData, updateFormData } = useAgentEditor();
  const [newDomain, setNewDomain] = useState('');

  const aiConfig = formData.aiConfig;

  const isAdmin = profile?.role === 'SUPER_ADMIN' || profile?.role === 'ADMIN';
  if (!isAdmin) return null;

  const routingMode = aiConfig.routingMode ?? 'n8n';

  const patchAiConfig = (patch: Partial<AgentAiConfigDto>) => {
    updateFormData('aiConfig', { ...aiConfig, ...patch });
  };

  // ---- n8n webhook handlers (unchanged behaviour) -----------------------
  const domains = formData.allowedDomains;
  const addDomains = (input: string) => {
    const parts = input.split(/[\s,]+/g).map(normalizeDomain).filter(Boolean);
    if (!parts.length) return;
    const next = [...domains];
    for (const p of parts) {
      if (!isValidDomain(p)) continue;
      if (!next.includes(p)) next.push(p);
    }
    updateFormData('allowedDomains', next);
    setNewDomain('');
  };
  const removeDomain = (d: string) => {
    updateFormData('allowedDomains', domains.filter((x) => x !== d));
  };

  // If the saved model isn't in our curated list (e.g. an older agent set to
  // a now-removed model), snap to the recommended default. The picker is
  // curated-only now — no custom input — so the value MUST match an option.
  const modelSelectValue = aiConfig.modelId && CURATED_MODELS.some((m) => m.value === aiConfig.modelId)
    ? aiConfig.modelId
    : CURATED_MODELS[0]!.value;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Integration</h3>
        <p className="text-sm text-muted-foreground">
          Choose how this agent handles chat: the legacy n8n webhook, or our
          native AI orchestrator with built-in streaming, caching, and
          observability.
        </p>
      </div>

      {/* Allowed Domains — applies to BOTH routing modes. The widget runs on
          customer sites and the API's WidgetCorsMiddleware checks every public
          request against this list regardless of whether the LLM serves via
          n8n or direct. Placed ABOVE the routing radio so the UX makes clear
          it isn't gated by that choice. Empty list = no CORS restrictions. */}
      <div className="space-y-2 rounded-lg border bg-muted/20 p-4">
        <Label className="text-sm font-medium">Allowed Domains</Label>
        <p className="text-xs text-muted-foreground">
          Whitelist of domains where this agent&apos;s widget is allowed to load.
          Leave empty to allow any origin (useful while developing). Applies
          to both n8n and direct routing modes.
        </p>
        <div className="flex gap-2">
          <Input
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addDomains(newDomain);
              }
            }}
            placeholder="example.com or localhost:5000"
          />
          <Button type="button" onClick={() => addDomains(newDomain)} size="sm">
            <Plus className="mr-1 h-4 w-4" /> Add
          </Button>
        </div>
        {domains.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {domains.map((d) => (
              <span
                key={d}
                className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs"
              >
                {d}
                <button
                  type="button"
                  onClick={() => removeDomain(d)}
                  className="ml-1 cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground"
                  aria-label={`Remove ${d}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Press Enter or comma after typing each domain. Ports are supported
          (e.g. <code className="text-[10px]">localhost:5000</code>).
        </p>
      </div>

      {/* Routing mode radio ------------------------------------------------ */}
      <RadioGroup
        value={routingMode}
        onValueChange={(v) => patchAiConfig({ routingMode: v as 'n8n' | 'direct' })}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        <label
          htmlFor="routing-n8n"
          className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
            routingMode === 'n8n' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'
          }`}
        >
          <RadioGroupItem value="n8n" id="routing-n8n" className="mt-1" />
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Webhook className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">n8n Webhook</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Forward every message to an n8n workflow you manage. Use for
              existing automations.
            </p>
          </div>
        </label>

        <label
          htmlFor="routing-direct"
          className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
            routingMode === 'direct' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'
          }`}
        >
          <RadioGroupItem value="direct" id="routing-direct" className="mt-1" />
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">AI Orchestrator</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Native LLM calls with streaming, prompt caching, and per-turn
              analytics. Recommended for new agents.
            </p>
          </div>
        </label>
      </RadioGroup>

      {/* Conditional LLM config panel ------------------------------------- */}
      {routingMode === 'n8n' ? (
        <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Webhook URL</Label>
            <Input
              value={formData.webhookUrl}
              onChange={(e) => updateFormData('webhookUrl', e.target.value)}
              placeholder="https://your-api.com/webhook"
            />
            <p className="text-xs text-muted-foreground">
              This URL will receive POST requests when users send messages.
            </p>
          </div>
        </div>
      ) : (
        <DirectModeConfig
          aiConfig={aiConfig}
          patch={patchAiConfig}
          modelSelectValue={modelSelectValue}
        />
      )}

    </div>
  );
}

/**
 * Direct-mode AI config panel. Only fields here — no routing mode radio (that
 * lives in the parent so both modes share it). Kept as a nested component
 * because the field set is large enough that inlining it would make
 * IntegrationSettings hard to read.
 */
function DirectModeConfig({
  aiConfig,
  patch,
  modelSelectValue,
}: {
  aiConfig: AgentAiConfigDto;
  patch: (p: Partial<AgentAiConfigDto>) => void;
  modelSelectValue: string;
}) {
  const selectedCurated = CURATED_MODELS.find((m) => m.value === modelSelectValue);

  // The advanced numeric fields live in a collapsed accordion. If either is
  // out of range, default the accordion open so its inline error is visible —
  // e.g. when a save attempt jumps the user to this tab. `defaultValue` is
  // evaluated on mount, and switching tabs remounts this section.
  const advancedInvalid =
    (aiConfig.maxContextMessages ?? 0) < 1 ||
    (aiConfig.maxContextMessages ?? 0) > 100 ||
    (aiConfig.maxInputTokens ?? 0) < 500 ||
    (aiConfig.maxInputTokens ?? 0) > 1_000_000;

  return (
    <div className="space-y-5 rounded-lg border bg-muted/20 p-4">
      {/* Model ---------------------------------------------------------- */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Model</Label>
        <Select
          value={modelSelectValue}
          onValueChange={(value) => patch({ modelId: value })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a model" />
          </SelectTrigger>
          <SelectContent>
            {CURATED_MODELS.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedCurated && (
          <p className="text-xs text-muted-foreground">{selectedCurated.hint}</p>
        )}
      </div>

      {/* Temperature --------------------------------------------------- */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Creativity</Label>
          <span className="text-sm tabular-nums text-muted-foreground">
            {(aiConfig.temperature ?? 0.7).toFixed(1)}
          </span>
        </div>
        <Slider
          value={[aiConfig.temperature ?? 0.7]}
          min={0}
          max={2}
          step={0.1}
          onValueChange={([v]) => patch({ temperature: v })}
        />
        <p className="text-xs text-muted-foreground">
          0 = deterministic/factual · 0.7 = balanced · 1.5+ = very creative.
        </p>
      </div>

      {/* Max output tokens ---------------------------------------------- */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Max response length (tokens)</Label>
        <Input
          type="number"
          // No `min`/`max` HTML attrs — let users type freely (including
          // clearing the field and retyping). The 1-32000 range is enforced by
          // the inline error below + the save-time guard, instead of silently
          // rejecting keystrokes.
          value={aiConfig.maxTokens ?? ''}
          onChange={(e) => {
            const raw = e.target.value;
            const n = raw === '' ? 0 : Number.parseInt(raw, 10);
            if (Number.isFinite(n) && n >= 0) patch({ maxTokens: n });
          }}
        />
        <p className="text-xs text-muted-foreground">
          Upper cap on how much the model can emit per reply. Range 1-32000.
          ~4 chars per token in English. Default 4096.
        </p>
        {(aiConfig.maxTokens ?? 0) < 1 || (aiConfig.maxTokens ?? 0) > 32000 ? (
          <p className="text-xs text-destructive">
            Must be between 1 and 32000.
          </p>
        ) : null}
      </div>

      {/* Advanced accordion -------------------------------------------- */}
      <Accordion
        type="single"
        collapsible
        defaultValue={advancedInvalid ? 'advanced' : undefined}
      >
        <AccordionItem value="advanced" className="border-b-0">
          <AccordionTrigger className="cursor-pointer py-2 text-sm font-medium">
            Advanced
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pt-2">
            {/* Max context messages */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                Past messages to remember
              </Label>
              <Input
                type="number"
                value={aiConfig.maxContextMessages ?? ''}
                onChange={(e) => {
                  const raw = e.target.value;
                  const n = raw === '' ? 0 : Number.parseInt(raw, 10);
                  if (Number.isFinite(n) && n >= 0) patch({ maxContextMessages: n });
                }}
              />
              <p className="text-xs text-muted-foreground">
                Hard cap. Older messages are dropped. Range 1-100. Default 20.
              </p>
              {(aiConfig.maxContextMessages ?? 0) < 1 ||
              (aiConfig.maxContextMessages ?? 0) > 100 ? (
                <p className="text-xs text-destructive">
                  Must be between 1 and 100.
                </p>
              ) : null}
            </div>

            {/* Max input tokens */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Input token budget</Label>
              <Input
                type="number"
                value={aiConfig.maxInputTokens ?? ''}
                onChange={(e) => {
                  const raw = e.target.value;
                  const n = raw === '' ? 0 : Number.parseInt(raw, 10);
                  if (Number.isFinite(n) && n >= 0) patch({ maxInputTokens: n });
                }}
              />
              <p className="text-xs text-muted-foreground">
                Total budget for system prompt + knowledge + history + new
                message. Context assembler drops oldest messages to fit. Range
                500-1,000,000. 8000 fits every model; raise to 200000+ for
                long-doc agents or 1M for Gemini.
              </p>
              {(aiConfig.maxInputTokens ?? 0) < 500 ||
              (aiConfig.maxInputTokens ?? 0) > 1_000_000 ? (
                <p className="text-xs text-destructive">
                  Must be between 500 and 1,000,000.
                </p>
              ) : null}
            </div>

            {/* Context strategy */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Context strategy</Label>
              <Select
                value={aiConfig.contextStrategy ?? 'sliding-window'}
                onValueChange={(v) =>
                  patch({ contextStrategy: v as AgentAiConfigDto['contextStrategy'] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sliding-window">Sliding window (default)</SelectItem>
                  <SelectItem value="summarize">Summarize older messages</SelectItem>
                  <SelectItem value="hybrid">Hybrid (recent + summary)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                How the agent builds context for long conversations.
                Sliding-window is cheapest and usually fine.
              </p>
            </div>

            {/* PII redaction */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">PII protection</Label>
                <Switch
                  checked={aiConfig.piiRedactionEnabled ?? false}
                  onCheckedChange={(v) => patch({ piiRedactionEnabled: v })}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Replaces sensitive details (bank/account numbers, dates of
                birth, IFSC codes) with placeholders before they reach the AI
                model and stored logs. Your team still sees real values in the
                Inbox. Detects identifiers in any language; name and address
                detection is not included yet. Government IDs and card numbers
                (Aadhaar, PAN, passport, cards) are always blocked, even with
                this off.
              </p>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
