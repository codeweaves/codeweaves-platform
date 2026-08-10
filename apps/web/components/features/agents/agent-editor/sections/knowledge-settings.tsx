'use client';

import { useRef } from 'react';
import { toast } from 'sonner';
import { Upload, FileText, Trash2, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import {
  KNOWLEDGE_UPLOAD_EXTENSIONS,
  MAX_KNOWLEDGE_TEXT_BYTES,
  MAX_KNOWLEDGE_UPLOAD_BYTES,
} from '@repo/validation';
import { useAgentEditor } from '../agent-editor-context';
import { useExtractKnowledgeFile } from '@/hooks/use-agent-knowledge';

const ACCEPT_MIME = '.pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown';

/** Char-based token estimate — matches the backend's budget-fit heuristic. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Knowledge Base editor — the "content" surface of the Prompt section. Reads
 * and writes `formData.knowledgeContent` (+ source metadata), same dirty-
 * tracking + single-save story as every other field.
 *
 * Two user actions live HERE, not in the main Save flow, because they're
 * file-extraction conveniences rather than persistence:
 *   - Upload button → POSTs to /knowledge/extract (server-side file → text),
 *     then seeds the textarea locally. No DB write.
 *   - Remove button → clears the local state (textarea + source metadata).
 *     The actual DELETE happens at Save time via the layout's handleSave.
 */
export function KnowledgeSettings() {
  const { agent, formData, updateFormData } = useAgentEditor();

  const extract = useExtractKnowledgeFile(agent.id);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const content = formData.knowledgeContent;
  const sourceFileName = formData.knowledgeSourceFileName;
  const hasContent = content.trim().length > 0;

  const draftBytes = new Blob([content]).size;
  const draftTokens = estimateTokens(content);
  const sizeOverLimit = draftBytes > MAX_KNOWLEDGE_TEXT_BYTES;

  const handleFileSelected = async (file: File) => {
    if (file.size > MAX_KNOWLEDGE_UPLOAD_BYTES) {
      toast.error(
        `File too large (${formatBytes(file.size)}). Max is ${formatBytes(MAX_KNOWLEDGE_UPLOAD_BYTES)}.`,
      );
      return;
    }
    try {
      const extracted = await extract.mutateAsync(file);
      updateFormData('knowledgeContent', extracted.content);
      updateFormData('knowledgeSourceFileName', extracted.sourceFileName ?? file.name);
      updateFormData('knowledgeSourceMimeType', extracted.sourceMimeType ?? file.type);
      toast.success(
        `Extracted ${extracted.contentTokens.toLocaleString()} tokens from ${file.name}. Click Save to apply.`,
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to extract text from file',
      );
    } finally {
      // Clear the native input so re-uploading the same file re-fires onChange.
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  /**
   * Clears local state only. The DELETE /knowledge call happens when the user
   * clicks the main Save button and the layout detects the content going from
   * non-empty → empty. Keeping this in-sync avoids double-calling the API and
   * lets the user change their mind (Reset restores the saved version).
   */
  const handleLocalRemove = () => {
    updateFormData('knowledgeContent', '');
    updateFormData('knowledgeSourceFileName', null);
    updateFormData('knowledgeSourceMimeType', null);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <Label className="text-sm font-medium">Knowledge Base</Label>
        <InfoTooltip
          label="Knowledge Base"
          content={
            <>
              <p>
                Factual reference material the agent answers from: FAQs, product
                specs, policies. Prepended to the system prompt on every direct-mode
                chat turn.
              </p>
              <p>
                Paste text, or upload {KNOWLEDGE_UPLOAD_EXTENSIONS.join(', ')}. Only
                the extracted text is stored, not the file.
              </p>
              <p>
                Max {formatBytes(MAX_KNOWLEDGE_TEXT_BYTES)} of text, and{' '}
                {formatBytes(MAX_KNOWLEDGE_UPLOAD_BYTES)} per upload.
              </p>
            </>
          }
        />
      </div>

      {/* Editable content textarea --------------------------------------- */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {sourceFileName ? (
              <span className="inline-flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                <span className="font-medium">{sourceFileName}</span>
              </span>
            ) : (
              <span>{hasContent ? 'Pasted text' : 'No content yet'}</span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
            <span>{draftTokens.toLocaleString()} tokens (est.)</span>
            <span>·</span>
            <span className={sizeOverLimit ? 'font-medium text-destructive' : ''}>
              {formatBytes(draftBytes)} / {formatBytes(MAX_KNOWLEDGE_TEXT_BYTES)}
            </span>
          </div>
        </div>
        <Textarea
          value={content}
          onChange={(e) => updateFormData('knowledgeContent', e.target.value)}
          placeholder="Paste or upload text here. E.g. company FAQs, product specs, service descriptions, policy documents…"
          className="min-h-80 font-mono text-sm"
          disabled={extract.isPending}
        />
        {sizeOverLimit && (
          <p className="text-xs text-destructive">
            Over the {formatBytes(MAX_KNOWLEDGE_TEXT_BYTES)} limit. For larger
            documents, use the RAG pipeline (coming soon) instead of the
            static knowledge base.
          </p>
        )}
      </div>

      {/* Actions below the textarea: upload/replace + clear --------------- */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {KNOWLEDGE_UPLOAD_EXTENSIONS.join(', ')} &middot; max{' '}
          {formatBytes(MAX_KNOWLEDGE_UPLOAD_BYTES)}
        </p>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_MIME}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFileSelected(file);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={extract.isPending}
          >
            {extract.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : hasContent ? (
              <RefreshCw className="mr-2 h-4 w-4" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            {extract.isPending
              ? 'Extracting…'
              : hasContent
                ? 'Replace from file'
                : 'Upload file'}
          </Button>
          {hasContent && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={handleLocalRemove}
              disabled={extract.isPending}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Clear
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
