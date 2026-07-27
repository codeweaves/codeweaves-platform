'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Mail, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useUnsavedChangesWarning } from '@/hooks/use-unsaved-changes-warning';
import {
  renderTemplatePreview,
  useEmailTemplate,
  useEmailTemplates,
  useUpdateEmailTemplate,
  type EmailTemplateVariable,
} from '@/hooks/use-email-templates';

/** Debounce on the preview so typing stays smooth on a large body. */
const PREVIEW_DEBOUNCE_MS = 300;

/**
 * Utilities → Email. Master–detail, mirroring the Inbox: template list on the
 * left, the selected template's subject + HTML/Preview tabs on the right.
 *
 * Templates are seeded server-side, so this edits only `subject` and `html` —
 * there is no create or delete.
 */
export function EmailTemplateEditor() {
  const { data: templates, isLoading: listLoading } = useEmailTemplates();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Land on the first template so the pane is never blank on arrival.
  useEffect(() => {
    if (!selectedKey && templates && templates.length > 0) {
      setSelectedKey(templates[0]!.key);
    }
  }, [templates, selectedKey]);

  return (
    <div className="flex h-[calc(100vh-11rem)] gap-4">
      {/* List */}
      <aside className="thin-scroll w-70 shrink-0 overflow-y-auto rounded-xl border border-border bg-background">
        {listLoading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading…</div>
        ) : !templates?.length ? (
          <div className="p-4 text-sm text-muted-foreground">No templates.</div>
        ) : (
          <ul className="divide-y divide-border">
            {templates.map((t) => (
              <li key={t.key}>
                <button
                  type="button"
                  onClick={() => setSelectedKey(t.key)}
                  className={cn(
                    'flex w-full items-start gap-2.5 px-3 py-3 text-left transition-colors',
                    selectedKey === t.key ? 'bg-accent' : 'hover:bg-accent/50',
                  )}
                >
                  <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{t.name}</span>
                    {t.description && (
                      <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                        {t.description}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* Detail */}
      <section className="min-w-0 flex-1 rounded-xl border border-border bg-background">
        {selectedKey ? (
          <TemplateDetail key={selectedKey} templateKey={selectedKey} />
        ) : (
          <div className="p-6 text-sm text-muted-foreground">
            Select a template to edit.
          </div>
        )}
      </section>
    </div>
  );
}

function TemplateDetail({ templateKey }: { templateKey: string }) {
  const { data, isLoading } = useEmailTemplate(templateKey);
  const update = useUpdateEmailTemplate();

  const [subject, setSubject] = useState('');
  const [html, setHtml] = useState('');
  const htmlRef = useRef<HTMLTextAreaElement>(null);

  // Seed the editor once the row arrives. Keyed remount (see parent) means this
  // never has to reconcile a switch between templates.
  useEffect(() => {
    if (data) {
      setSubject(data.subject);
      setHtml(data.html);
    }
  }, [data]);

  const dirty = !!data && (subject !== data.subject || html !== data.html);
  useUnsavedChangesWarning(dirty);

  const onSave = useCallback(() => {
    if (!dirty) return;
    update.mutate(
      { key: templateKey, subject, html },
      {
        onSuccess: () => toast.success('Template saved'),
        onError: (err: unknown) =>
          toast.error(err instanceof Error ? err.message : 'Could not save template'),
      },
    );
  }, [dirty, update, templateKey, subject, html]);

  /** Insert a `{{variable}}` at the cursor so nobody has to type the braces. */
  const insertVariable = useCallback(
    (variable: EmailTemplateVariable) => {
      const token = `{{${variable.key}}}`;
      const el = htmlRef.current;
      if (!el) {
        setHtml((prev) => prev + token);
        return;
      }
      const start = el.selectionStart ?? html.length;
      const end = el.selectionEnd ?? html.length;
      const next = html.slice(0, start) + token + html.slice(end);
      setHtml(next);
      // Restore the caret after the inserted token on the next paint.
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      });
    },
    [html],
  );

  if (isLoading || !data) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-border p-4">
        <div className="flex items-end gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="templateSubject" className="text-sm font-medium">
              Subject
            </Label>
            <Input
              id="templateSubject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={300}
            />
          </div>
          <Button onClick={onSave} disabled={!dirty || update.isPending}>
            {update.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Save />
            )}
            Save
          </Button>
        </div>

        {/* Radix requires a TooltipProvider ancestor or Root throws. There is no
            global one in this app — every call site wraps locally. */}
        <TooltipProvider delayDuration={150}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Variables:</span>
            {data.variables.map((v) => (
              <Tooltip key={v.key}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => insertVariable(v)}
                    className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-foreground transition-colors hover:bg-accent"
                  >
                    {`{{${v.key}}}`}
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {v.label} — e.g. &ldquo;{v.sample}&rdquo;. Click to insert.
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>
      </div>

      <Tabs defaultValue="html" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-4 mt-3 self-start">
          <TabsTrigger value="html">HTML</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>

        <TabsContent value="html" className="min-h-0 flex-1 p-4 pt-3">
          <textarea
            ref={htmlRef}
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            spellCheck={false}
            className="thin-scroll h-full w-full resize-none rounded-lg border border-input bg-transparent p-3 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </TabsContent>

        <TabsContent value="preview" className="min-h-0 flex-1 p-4 pt-3">
          <TemplatePreview html={html} variables={data.variables} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Renders the pasted HTML with sample values filled in.
 *
 * SANDBOXED IFRAME, deliberately: this body is arbitrary HTML typed into a
 * textarea, and rendering it inline would let a stray `<script>` (or a pasted
 * snippet from anywhere) run with the dashboard's origin, session and tokens.
 * The sandbox attribute is empty — no scripts, no same-origin, no forms — so
 * the preview can only ever draw itself.
 */
function TemplatePreview({
  html,
  variables,
}: {
  html: string;
  variables: EmailTemplateVariable[];
}) {
  const [debounced, setDebounced] = useState(html);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(html), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [html]);

  const rendered = useMemo(
    () => renderTemplatePreview(debounced, variables),
    [debounced, variables],
  );

  return (
    <iframe
      title="Email preview"
      sandbox=""
      srcDoc={rendered}
      className="h-full w-full rounded-lg border border-input bg-white"
    />
  );
}
