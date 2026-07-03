import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * A field the extractor should pull from a conversation. Decoupled from the
 * Prisma/validation enums on purpose — the caller maps its own field type to a
 * JSON primitive and does any free deterministic (regex) extraction first, so
 * only fields that genuinely need an LLM reach `extractFields`.
 */
export interface ExtractableField {
  key: string;
  label: string;
  jsonType: 'string' | 'number' | 'boolean';
  description?: string | null;
}

/**
 * Tiny AI classifier used by the background categorisation job.
 *
 * Scope is deliberately narrow: two pure-text classification primitives
 * (pick-from-list + ISO-language-detect) backed by OpenAI Chat Completions
 * with **structured outputs in strict mode** — the model is decoder-forced
 * to produce JSON matching a schema we control, so it physically cannot
 * invent a category, return prose, or skip required fields. No prompt-
 * framework, no streaming, no retries beyond the network's own.
 *
 * The service is **graceful when unconfigured**: missing OPENAI_API_KEY
 * does not throw at boot — callers just get `null` back. This keeps local
 * dev and CI usable without secret provisioning.
 */
@Injectable()
export class AiClassifierService {
  private readonly logger = new Logger(AiClassifierService.name);
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly endpoint = 'https://api.openai.com/v1/chat/completions';

  // Sentinel returned by the model when no category fits / the conversation
  // is too thin to classify confidently. Kept distinct from real category
  // names so the enum check in `categorize` can rule it out cleanly.
  private static readonly NO_MATCH = 'NONE';
  // Sentinel returned by `detectLanguage` for "couldn't tell" — distinct
  // from `other` (which means "I can tell, but it's outside the allowed
  // list"). Both translate to null in the persistence layer.
  private static readonly LANG_UNKNOWN = 'und';
  private static readonly LANG_OTHER = 'other';

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('OPENAI_API_KEY');
    // gpt-4o-mini is the cheapest GPT-4-class model at the time of writing
    // (~$0.15/1M input tokens) and supports structured outputs in strict
    // mode. A typical 6-message conversation runs ~1K tokens — categorisation
    // overhead is effectively free at our scale.
    this.model = config.get<string>('AI_CLASSIFIER_MODEL') ?? 'gpt-4o-mini';
    if (!this.apiKey) {
      this.logger.warn(
        'OPENAI_API_KEY not set — AiClassifierService will no-op. Background categorisation will skip.',
      );
    }
  }

  /** True when the service has credentials and can make calls. */
  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /**
   * Classify a conversation transcript into one of the supplied categories.
   *
   * Returns the matched category (verbatim from `categories`) or `null` when:
   *   - the conversation is too thin/vague to label (model returns NONE),
   *   - the model's confidence is "low" — we prefer no label over a guess,
   *   - the provider call fails or returns an unexpected shape.
   *
   * The category enum sent in the schema is `[...categories, 'NONE']`, so the
   * decoder physically cannot return a category that isn't on the list.
   */
  async categorize(
    transcript: string,
    categories: string[],
  ): Promise<string | null> {
    if (!this.apiKey || categories.length === 0 || !transcript.trim()) {
      return null;
    }

    const system = [
      'You are classifying a chat conversation between an end-user and an AI assistant.',
      'Pick exactly ONE category from the list that best describes what the user was asking about.',
      '',
      'Pick "NONE" if any of these are true:',
      '- No category in the list reasonably matches the conversation topic.',
      '- The conversation is too short or too vague to determine intent (e.g. just greetings, single-word replies, off-topic chitchat).',
      '- The user\'s intent is genuinely unclear or ambiguous across multiple categories.',
      '',
      'For confidence:',
      '- "high": the topic is obvious from the messages.',
      '- "medium": the topic is probable but there is some ambiguity.',
      '- "low": you would be guessing — in this case you SHOULD pick "NONE".',
      '',
      'Reply with JSON matching the provided schema. Categories must be picked verbatim from the supplied list.',
    ].join('\n');

    const user = [
      'Allowed categories:',
      categories.map((c) => `- ${c}`).join('\n'),
      '',
      'Transcript:',
      truncate(transcript, 6000),
    ].join('\n');

    // Build the enum from the caller's category list + the NONE sentinel.
    // Strict-mode JSON schema enforces this at decode time — the model
    // literally cannot return a string outside this set.
    const schema = {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: [...categories, AiClassifierService.NO_MATCH],
        },
        confidence: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
        },
      },
      required: ['category', 'confidence'],
      additionalProperties: false,
    } as const;

    const parsed = await this.chatJson<{
      category: string;
      confidence: 'high' | 'medium' | 'low';
    }>(system, user, schema, 'classification');
    if (!parsed) return null;

    if (parsed.category === AiClassifierService.NO_MATCH) {
      return null;
    }
    if (parsed.confidence === 'low') {
      // The model itself flagged it as a guess — store null and let analytics
      // skip it rather than poisoning the bucket counts.
      this.logger.debug(
        `Classifier picked "${parsed.category}" with low confidence; storing null.`,
      );
      return null;
    }

    // Defensive: the schema already constrains category to the allowed list,
    // but a future schema change or a malformed response shouldn't crash.
    const hit = categories.find((c) => c === parsed.category);
    if (!hit) {
      this.logger.warn(
        `Classifier returned "${parsed.category}" which is not in the allowed list; treating as no match.`,
      );
      return null;
    }
    return hit;
  }

  /**
   * Detect the primary language of `text`. Returns one of the codes in
   * `allowedLanguages`, or the string `"other"` when the language is real
   * but outside the allowed list, or `null` when undetermined / unconfigured.
   *
   * The enum is built dynamically per-call from the agent's chosen languages
   * (mostly ISO 639-1, plus the non-standard `hinglish` value for code-mixed
   * Hindi-English). "other" is appended so the analytics dashboard can
   * surface unmet language demand — a CLIENT seeing "8% Other" knows there's
   * a market they haven't configured for. "und" is appended for genuine
   * "can't tell" — empty / one-word inputs.
   *
   * Returns null when `allowedLanguages` is empty (feature disabled for the
   * agent) — the caller doesn't need to special-case the empty list.
   */
  async detectLanguage(
    text: string,
    allowedLanguages: string[],
  ): Promise<string | null> {
    if (!this.apiKey || !text.trim() || allowedLanguages.length === 0) {
      return null;
    }

    const includesHinglish = allowedLanguages.includes('hinglish');
    const enumValues = [
      ...allowedLanguages,
      AiClassifierService.LANG_OTHER,
      AiClassifierService.LANG_UNKNOWN,
    ];

    // System prompt is tailored to the agent's allowed list, with extra
    // guidance when "hinglish" is in scope — the LLM needs to know when to
    // pick `hinglish` vs `hi` vs `en`, since those three otherwise overlap
    // heavily on code-mixed content.
    const systemLines = [
      'Detect the primary language of the given conversation.',
      `Reply with one of the language codes from the schema, "${AiClassifierService.LANG_OTHER}" if the language is real but not in the allowed list, or "${AiClassifierService.LANG_UNKNOWN}" if undetermined.`,
      '',
      `Allowed: ${allowedLanguages.join(', ')}.`,
      '',
      `Use "${AiClassifierService.LANG_UNKNOWN}" if:`,
      '- The text is too short to tell (e.g. just one or two words).',
      '- The conversation is so mixed there is no dominant primary language.',
      '',
      `Use "${AiClassifierService.LANG_OTHER}" if you can identify the language but it is not in the allowed list (e.g. allowed is [en, hi] but the conversation is in Spanish).`,
    ];
    if (includesHinglish) {
      systemLines.push(
        '',
        'Hinglish guidance:',
        '- Use "hinglish" when the conversation has substantial Hindi vocabulary written in Latin script mixed with English (e.g. "Mera order kahan hai, can you check please?").',
        '- Use "hi" only for predominantly Devanagari-script Hindi.',
        '- Use "en" for predominantly English text with at most a few foreign-loan words.',
      );
    }
    systemLines.push(
      '',
      'For predominantly-one-language conversations with a few foreign words sprinkled in, pick the dominant language — do NOT use "und".',
    );

    const schema = {
      type: 'object',
      properties: {
        language: {
          type: 'string',
          enum: enumValues,
        },
      },
      required: ['language'],
      additionalProperties: false,
    } as const;

    const parsed = await this.chatJson<{ language: string }>(
      systemLines.join('\n'),
      truncate(text, 2000),
      schema,
      'language_detection',
    );
    if (!parsed) return null;
    if (parsed.language === AiClassifierService.LANG_UNKNOWN) return null;
    // "other" is persisted — it's the explicit "real language but not on the
    // allowed list" signal. Analytics surfaces it as unmet language demand.
    if (parsed.language === AiClassifierService.LANG_OTHER) {
      return AiClassifierService.LANG_OTHER;
    }
    // Schema-enforced membership, but defensive — anything truly off-list
    // (shouldn't happen under strict mode) is treated as undetermined.
    if (!allowedLanguages.includes(parsed.language)) {
      return null;
    }
    return parsed.language;
  }

  /**
   * Extract structured field values from a conversation transcript. Used by the
   * background data-capture extractor — NEVER on the reply hot path.
   *
   * Only fields that genuinely need reasoning should reach here; deterministic
   * ones (email, phone) are pulled by regex upstream, for free. Returns a map
   * of field key → value for every field the USER actually provided (absent
   * fields are omitted). Returns null when unconfigured or the call fails.
   *
   * Strict structured outputs: every field is a NULLABLE property, so the
   * decoder returns null for anything it can't find rather than fabricating.
   */
  async extractFields(
    transcript: string,
    fields: ExtractableField[],
  ): Promise<Record<string, string | number | boolean> | null> {
    if (!this.apiKey || fields.length === 0 || !transcript.trim()) {
      return null;
    }

    const properties: Record<string, unknown> = {};
    for (const f of fields) {
      properties[f.key] = {
        // Nullable: lets the model say "not provided" under strict mode, which
        // requires every property to be present in `required`.
        type: [f.jsonType, 'null'],
        description: f.description ? `${f.label}. ${f.description}` : f.label,
      };
    }
    const schema = {
      type: 'object',
      properties,
      required: fields.map((f) => f.key),
      additionalProperties: false,
    } as const;

    const system = [
      'You extract structured details that an END-USER gave about THEMSELVES in a chat.',
      'The transcript is labelled by speaker: [USER] is the person whose data we want; [ASSISTANT] is the business\'s side — its bot OR a human teammate who took the chat over. Use [ASSISTANT] turns only as CONTEXT to understand the conversation — NEVER extract a value from them.',
      'HARD RULE: a value that appears only in an [ASSISTANT] turn is the BUSINESS\'s, never the user\'s. Contact details the bot or teammate shares — e.g. "contact us at support@acme.com", "reach our team at +1 555-0100", "this is Sam, my email is sam@acme.com" — must NOT be extracted; return null for that field.',
      'Read the MEANING of each sentence. Only extract a value when the user is giving it as their OWN — usually phrased like "my email is…", "I\'m…", "my number is…", "my customer id is…".',
      'Do NOT extract a value the user is referring to as the business\'s or someone else\'s — e.g. "your email is…?", "is this your number?", "I saw it on your website". Those are not the user\'s data.',
      'If the user did not provide a field about themselves, return null for it — the JSON value null, never the text "null". NEVER guess, infer, or fabricate.',
      'Example: the [ASSISTANT] says "reach us at support@acme.com or +1 555-0100" and the [USER] never states their own email or phone → email = null and phone = null.',
      'Reply with JSON matching the provided schema exactly.',
    ].join('\n');

    const user = [
      'Fields to extract:',
      fields
        .map(
          (f) =>
            `- ${f.key}: ${f.description ? `${f.label} (${f.description})` : f.label}`,
        )
        .join('\n'),
      '',
      'Transcript:',
      truncate(transcript, 8000),
    ].join('\n');

    const parsed = await this.chatJson<Record<string, unknown>>(
      system,
      user,
      schema,
      'field_extraction',
      512,
    );
    if (!parsed) return null;

    // Keep only non-null values of the expected primitive type. Strict mode
    // should guarantee this, but we validate defensively before persisting.
    const result: Record<string, string | number | boolean> = {};
    for (const f of fields) {
      const value = parsed[f.key];
      if (value === null || value === undefined) continue;
      if (
        f.jsonType === 'string' &&
        typeof value === 'string' &&
        !isNoValue(value)
      ) {
        result[f.key] = value.trim();
      } else if (f.jsonType === 'number' && typeof value === 'number') {
        result[f.key] = value;
      } else if (f.jsonType === 'boolean' && typeof value === 'boolean') {
        result[f.key] = value;
      }
    }
    return result;
  }

  /**
   * Single-shot Chat Completions call with strict structured outputs.
   * Centralised so retry/timeout/error/parsing behaviour stays consistent
   * across `categorize` and `detectLanguage`.
   *
   * Returns the parsed JSON object (typed as T) or `null` for any of:
   *   - non-2xx HTTP response (rate-limited, auth error, provider down)
   *   - model "refusal" (per OpenAI's safety-refusal mechanism)
   *   - network error / timeout
   *   - JSON parse error (shouldn't happen under strict mode, but defensive)
   */
  private async chatJson<T>(
    system: string,
    user: string,
    schema: Record<string, unknown>,
    schemaName: string,
    maxTokens = 64,
  ): Promise<T | null> {
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey!}`,
        },
        body: JSON.stringify({
          model: this.model,
          // Low temperature keeps the classifier deterministic. We don't need
          // creative writing — we need consistent labels for analytics buckets.
          temperature: 0,
          // Structured outputs can be slightly longer than free-text. 64 is
          // plenty for a single classification label; callers extracting
          // several fields pass a larger cap.
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: schemaName,
              strict: true,
              schema,
            },
          },
        }),
        // 15s is generous for a single-message classification — anything
        // slower than this means the provider is degraded; failing fast lets
        // the worker move on to other sessions.
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.warn(
          `Classifier HTTP ${res.status}: ${body.slice(0, 200)}`,
        );
        return null;
      }

      const json = (await res.json()) as {
        choices?: Array<{
          message?: { content?: string; refusal?: string };
        }>;
      };
      const message = json.choices?.[0]?.message;
      if (message?.refusal) {
        // OpenAI's safety system returned a refusal instead of content.
        // Don't bury — this is rare enough to log loudly so it's investigated.
        this.logger.warn(`Classifier refused: ${message.refusal}`);
        return null;
      }
      if (!message?.content) {
        this.logger.warn('Classifier returned no content.');
        return null;
      }

      try {
        return JSON.parse(message.content) as T;
      } catch (err) {
        // Should be impossible under strict structured outputs, but a
        // provider regression could re-introduce it. Log + fall back to null.
        this.logger.warn(
          `Classifier returned non-JSON content: ${err instanceof Error ? err.message : 'unknown'} — body: ${message.content.slice(0, 200)}`,
        );
        return null;
      }
    } catch (err) {
      this.logger.warn(
        `Classifier call failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
      return null;
    }
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  // Truncate from the start (keep most recent turns) — most classifier-
  // relevant context tends to be at the END of a conversation, where the
  // user has clarified what they actually want.
  return s.slice(s.length - max);
}

/**
 * Strings models sometimes emit for "not provided" INSTEAD of a real JSON null.
 * The schema marks fields nullable, but the literal text "null" is still a valid
 * string, so strict mode lets it through — we must reject these ourselves so we
 * never persist a field whose value is the word "null".
 */
const NO_VALUE_SENTINELS = new Set([
  'null',
  'none',
  'n/a',
  'na',
  'nil',
  'undefined',
  'unknown',
  'not provided',
  'not given',
  '-',
  '—',
]);

/** True when a string value should be treated as "no value" (skip it). */
function isNoValue(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === '' || NO_VALUE_SENTINELS.has(v);
}
