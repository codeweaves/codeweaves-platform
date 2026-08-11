import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AppLogger } from '../common/logger/app-logger';
import {
  type EmailTemplateKey,
  isEmailTemplateKey,
  templateVariables,
} from './email-template.registry';

/** How long a fetched template stays cached. Copy changes ~never; this keeps a
 *  DB round-trip off every send. A dashboard edit busts the key immediately. */
const CACHE_TTL_MS = 60_000;

/** Matches `{{ varName }}` with optional inner whitespace. */
const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

interface CachedTemplate {
  subject: string;
  html: string;
  cachedAt: number;
}

/**
 * Escape a value before it lands inside template HTML.
 *
 * Templates are authored by a SUPER_ADMIN, but the VALUES substituted into them
 * come from the outside world — an agent name, an organization name, a visitor
 * name. Without this, an org called `<script>…` or an agent named
 * `"><img onerror=…>` would inject markup into every email built from that
 * template (and, more immediately, into the preview iframe). Escaping the five
 * significant characters also covers attribute contexts like
 * `href="{{conversationUrl}}"`, because `"` can no longer close the attribute.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Defence in depth for values that land in an `href`. Everything we substitute
 * today is server-built, but a `javascript:`/`data:` URL reaching an anchor is
 * the classic way a "harmless string" becomes execution, so anything that isn't
 * plainly http(s) or mailto is dropped to '#' rather than rendered.
 */
function sanitizeUrlValue(value: string): string {
  const trimmed = value.trim();
  return /^(https?:|mailto:)/i.test(trimmed) ? trimmed : '#';
}

/**
 * Renders the DB-backed transactional email templates that SUPER_ADMINs edit in
 * Utilities → Email. Pure rendering — it does not decide who gets mail (that's
 * NotificationMailerService) and does not send (that's EmailService).
 */
@Injectable()
export class EmailTemplateService {
  private readonly log = new AppLogger(EmailTemplateService.name);
  private readonly cache = new Map<string, CachedTemplate>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Render a template to a ready-to-send email.
   *
   * Substitution is a SINGLE pass: replacement text is never rescanned, so a
   * value that itself contains `{{something}}` cannot trigger a second
   * substitution round.
   */
  async render(
    key: EmailTemplateKey,
    vars: Record<string, string | null | undefined>,
  ): Promise<RenderedEmail> {
    const template = await this.load(key);

    // Only variables declared in the registry are substitutable. Anything else
    // in the template resolves to '' rather than leaking a raw `{{typo}}`.
    const allowed = new Set(templateVariables(key).map((v) => v.key));

    const substitute = (source: string, escape: boolean): string =>
      source.replace(PLACEHOLDER_RE, (_match, name: string) => {
        if (!allowed.has(name)) return '';
        const raw = vars[name];
        if (raw === null || raw === undefined) return '';
        const value = /url$/i.test(name) ? sanitizeUrlValue(String(raw)) : String(raw);
        return escape ? escapeHtml(value) : value;
      });

    const html = substitute(template.html, true);
    // The subject is a plain-text header — HTML-escaping it would put a literal
    // `&amp;` in the inbox. Strip CR/LF instead: that is the only injection that
    // matters for a header (it would let a value forge extra headers).
    const subject = substitute(template.subject, false).replace(/[\r\n]+/g, ' ').trim();

    return { subject, html, text: htmlToText(html) };
  }

  /** Read-through cache around the template row. */
  private async load(key: EmailTemplateKey): Promise<CachedTemplate> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.cachedAt < CACHE_TTL_MS) return hit;

    const row = await this.prisma.emailTemplate.findUnique({
      where: { key },
      select: { subject: true, html: true },
    });
    if (!row) {
      // Seeded by migration, so this means drift between code and DB.
      this.log.error('load', `email template '${key}' is missing from the database`);
      throw new NotFoundException(`Email template '${key}' not found`);
    }

    const entry: CachedTemplate = { ...row, cachedAt: Date.now() };
    this.cache.set(key, entry);
    return entry;
  }

  /** Drop a key from the cache — called right after a dashboard edit so the
   *  next send uses the new copy instead of waiting out the TTL. */
  invalidate(key: string): void {
    this.cache.delete(key);
  }

  // ---------------------------------------------------------------------------
  // Editor (Utilities → Email, SUPER_ADMIN only)
  // ---------------------------------------------------------------------------

  /** Template list for the left-hand pane. Omits `html` — the list view never
   *  needs it and the bodies are large. */
  async listForEditor() {
    return this.prisma.emailTemplate.findMany({
      orderBy: { name: 'asc' },
      select: {
        key: true,
        name: true,
        description: true,
        subject: true,
        updatedAt: true,
        updatedBy: true,
      },
    });
  }

  /** One template plus the variables it may use (drives the chips + preview). */
  async getForEditor(key: EmailTemplateKey) {
    const row = await this.prisma.emailTemplate.findUnique({ where: { key } });
    if (!row) throw new NotFoundException(`Email template '${key}' not found`);
    return { ...row, variables: templateVariables(key) };
  }

  /**
   * Update the editable fields.
   *
   * Uses `update` (not upsert) so a key outside the seeded set can never create
   * a row — the template list stays exactly what the code sends. Returns the
   * before/after subject so the caller can write a meaningful audit entry.
   */
  async updateFromEditor(
    key: EmailTemplateKey,
    input: { subject: string; html: string },
    updatedBy: string,
  ) {
    const before = await this.prisma.emailTemplate.findUnique({
      where: { key },
      select: { subject: true, html: true },
    });
    if (!before) throw new NotFoundException(`Email template '${key}' not found`);

    const row = await this.prisma.emailTemplate.update({
      where: { key },
      data: { subject: input.subject, html: input.html, updatedBy },
    });

    // Without this the edit would not take effect for up to CACHE_TTL_MS, which
    // reads as "my change didn't save".
    this.invalidate(key);

    return { row, before };
  }

  /** Render arbitrary (unsaved) HTML for the editor's live preview. Used only
   *  by the SUPER_ADMIN preview path; never by a real send. */
  renderPreview(
    key: string,
    html: string,
    subject: string,
    vars: Record<string, string>,
  ): { subject: string; html: string } {
    if (!isEmailTemplateKey(key)) return { subject, html };
    const allowed = new Set(templateVariables(key).map((v) => v.key));
    const substitute = (source: string, escape: boolean): string =>
      source.replace(PLACEHOLDER_RE, (_m, name: string) => {
        if (!allowed.has(name)) return '';
        const value = vars[name] ?? '';
        return escape ? escapeHtml(value) : value;
      });
    return {
      subject: substitute(subject, false).replace(/[\r\n]+/g, ' ').trim(),
      html: substitute(html, true),
    };
  }
}

/**
 * Derive the plain-text alternative from the rendered HTML.
 *
 * Not cosmetic: an HTML-only message is a well-known spam signal, and a
 * multipart message with a text part measurably improves inbox placement.
 * Deliberately crude — good enough for transactional mail, no parser needed.
 */
export function htmlToText(html: string): string {
  // Input is server-built HTML whose substituted VALUES were already
  // HTML-escaped by `escapeHtml`, and the OUTPUT is the text/plain email part
  // (never rendered as HTML) — so this is text extraction, not a security
  // boundary. Even so, tag removal loops until the string stops changing, so an
  // overlapping/nested construct like `<scr<script>ipt>` can't reconstruct a
  // tag after a single pass; close tags use `[^>]*>` so attribute/whitespace
  // variants can't slip through; and `&amp;` is decoded LAST so `&amp;lt;`
  // can't be double-decoded into a live `<`.
  // Remove <script>/<style> blocks with an imperative indexOf/slice scan rather
  // than a regex: a regex "tag remover" is inherently bypassable, and this is a
  // text/plain generator on already-escaped input (not a security boundary), so
  // this is about producing clean text.
  let text = stripTagBlocks(stripTagBlocks(html, 'script'), 'style');
  let prev: string;

  // Turn block/line-break tags into newlines before stripping the rest.
  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)[^>]*>/gi, '\n');

  // Strip all remaining tags, looping until stable.
  do {
    prev = text;
    text = text.replace(/<[^>]*>/g, '');
  } while (text !== prev);

  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

/**
 * Remove every `<tag …>…</tag>` block (and a trailing UNCLOSED `<tag …>`) for a
 * given tag name, scanning with indexOf/slice instead of a regex.
 *
 * A regex tag-stripper is the classic "incomplete sanitizer": one pass can
 * always be defeated by an overlapping construct, and looping a regex is fragile
 * to reason about. This linear scan is unconditionally complete — once an
 * opening `<tag` has no matching `</tag`, the rest of the string is dropped, so
 * nothing after an opener can survive. Case-insensitive; a boundary check keeps
 * `<style>` matching while `<styles>`/`<scripting>` do not.
 */
function stripTagBlocks(input: string, tag: string): string {
  const lower = input.toLowerCase();
  const openNeedle = '<' + tag;
  const closeNeedle = '</' + tag;
  let out = '';
  let i = 0;

  for (;;) {
    // Find the next real opener: `<tag` followed by a tag boundary, not a longer
    // name (`<styles`). Skip past false matches.
    let open = lower.indexOf(openNeedle, i);
    while (open !== -1) {
      const after = lower[open + openNeedle.length];
      if (after === undefined || after === '>' || after === '/' || /\s/.test(after)) {
        break;
      }
      open = lower.indexOf(openNeedle, open + 1);
    }
    if (open === -1) return out + input.slice(i);

    out += input.slice(i, open);
    const close = lower.indexOf(closeNeedle, open);
    if (close === -1) return out; // Unclosed block → drop the remainder entirely.
    const gt = input.indexOf('>', close);
    i = gt === -1 ? input.length : gt + 1;
  }
}
