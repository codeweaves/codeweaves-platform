'use client';

import { useRef, useState } from 'react';
import {
  Upload,
  Link2,
  Loader2,
  RefreshCw,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  MAX_DOCUMENT_UPLOAD_BYTES,
  MAX_DOCUMENTS_PER_AGENT,
  type AgentAiConfigDto,
  type ChunkingStrategy,
} from '@repo/validation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  useAgentDocuments,
  useUploadDocument,
  useIngestUrl,
  useReindexDocument,
  useDeleteDocument,
  isDocumentProcessing,
  type AgentDocument,
} from '@/hooks/use-agent-documents';
import { formatDate } from '@/lib/utils';
import { useAgentEditor } from '../agent-editor-context';
import { FormSection } from '../form-section';

/** Extensions the backend's text extractors support. Validated client-side
 * by extension (Windows often reports empty/odd MIME types for .md files). */
const ACCEPTED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md'];
const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.join(',');

const MAX_UPLOAD_MB = Math.round(MAX_DOCUMENT_UPLOAD_BYTES / (1024 * 1024));

const CHUNKING_OPTIONS: Array<{
  value: ChunkingStrategy;
  label: string;
  hint: string;
}> = [
  {
    value: 'recursive',
    label: 'Smart (recommended)',
    hint: 'Splits on paragraphs, then sentences, keeping related text together. Best general default.',
  },
  {
    value: 'markdown',
    label: 'Heading-aware',
    hint: 'Splits on headings first so sections stay intact. Best for manuals, wikis and FAQs.',
  },
  {
    value: 'fixed',
    label: 'Fixed size',
    hint: 'Plain fixed-size windows. Cheapest and most predictable for uniform prose.',
  },
];

function StatusBadge({ doc }: { doc: AgentDocument }) {
  switch (doc.status) {
    case 'PENDING':
      return <Badge variant="secondary">Queued</Badge>;
    case 'PROCESSING':
      return (
        <Badge variant="secondary">
          <Loader2 className="animate-spin" /> Processing
        </Badge>
      );
    case 'READY':
      return <Badge variant="success">Indexed</Badge>;
    case 'FAILED':
      return doc.errorMessage ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="destructive" className="cursor-help">
              Failed
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            {doc.errorMessage}
          </TooltipContent>
        </Tooltip>
      ) : (
        <Badge variant="destructive">Failed</Badge>
      );
  }
}

export function KnowledgeBaseSettings() {
  const { agent, formData, updateFormData } = useAgentEditor();

  const aiConfig = formData.aiConfig;
  const patchAiConfig = (patch: Partial<AgentAiConfigDto>) => {
    updateFormData('aiConfig', { ...aiConfig, ...patch });
  };

  const documentsQuery = useAgentDocuments(agent.id);
  const upload = useUploadDocument(agent.id);
  const ingestUrl = useIngestUrl(agent.id);
  const reindex = useReindexDocument(agent.id);
  const removeDocument = useDeleteDocument(agent.id);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [urlValue, setUrlValue] = useState('');
  const [urlName, setUrlName] = useState('');

  const documents = documentsQuery.data ?? [];
  const atLimit = documents.length >= MAX_DOCUMENTS_PER_AGENT;

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so picking the same file again re-triggers onChange.
    e.target.value = '';
    if (!file) return;

    const ext = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      toast.error(
        `Unsupported file type. Use ${ACCEPTED_EXTENSIONS.join(', ')}.`,
      );
      return;
    }
    if (file.size > MAX_DOCUMENT_UPLOAD_BYTES) {
      toast.error(`File is too large. Max size is ${MAX_UPLOAD_MB}MB.`);
      return;
    }

    upload.mutate(file, {
      onSuccess: () => toast.success(`"${file.name}" uploaded — indexing…`),
      onError: (err) => toast.error(err.message || 'Upload failed'),
    });
  };

  const handleIngestUrl = () => {
    const url = urlValue.trim();
    if (!url) {
      toast.error('Enter a URL to add.');
      return;
    }
    ingestUrl.mutate(
      { url, name: urlName.trim() || undefined },
      {
        onSuccess: () => {
          toast.success('Page added — indexing…');
          setUrlDialogOpen(false);
          setUrlValue('');
          setUrlName('');
        },
        onError: (err) => toast.error(err.message || 'Failed to add URL'),
      },
    );
  };

  const handleReindex = (doc: AgentDocument) => {
    reindex.mutate(doc.id, {
      onSuccess: () => toast.success(`Re-indexing "${doc.name}"…`),
      onError: (err) => toast.error(err.message || 'Re-index failed'),
    });
  };

  const handleDelete = (doc: AgentDocument) => {
    removeDocument.mutate(doc.id, {
      onSuccess: () => toast.success(`"${doc.name}" deleted`),
      onError: (err) => toast.error(err.message || 'Delete failed'),
    });
  };

  const selectedChunking = CHUNKING_OPTIONS.find(
    (o) => o.value === (aiConfig.ragChunkingStrategy ?? 'recursive'),
  );

  return (
    <div className="space-y-10">
      {/* RAG config — saved via the central Save button like other aiConfig
          fields. Only the document manager below mutates immediately. */}
      <FormSection
        title="Knowledge Base"
        description="Upload documents or web pages the AI retrieves from on demand — answers cite their sources. Retrieval settings here save with the main Save button."
      >
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5 pr-4">
            <Label className="text-sm font-medium">
              Use knowledge base when answering
            </Label>
            <p className="text-xs text-muted-foreground">
              Automatically retrieve relevant document passages before each
              reply. Turn off to ignore documents without deleting them.
            </p>
          </div>
          <Switch
            checked={aiConfig.ragEnabled ?? true}
            onCheckedChange={(checked) => patchAiConfig({ ragEnabled: checked })}
          />
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Chunking strategy</Label>
          <Select
            value={aiConfig.ragChunkingStrategy ?? 'recursive'}
            onValueChange={(v) =>
              patchAiConfig({ ragChunkingStrategy: v as ChunkingStrategy })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHUNKING_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedChunking && (
            <p className="text-xs text-muted-foreground">
              {selectedChunking.hint}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Applies to newly added documents — use Re-index to apply to
            existing ones.
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Retrieval strategy</Label>
          <Select
            value={aiConfig.ragRetrievalStrategy ?? 'hybrid'}
            onValueChange={(v) =>
              patchAiConfig({
                ragRetrievalStrategy: v as AgentAiConfigDto['ragRetrievalStrategy'],
              })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hybrid">
                Hybrid — semantic + keyword (recommended)
              </SelectItem>
              <SelectItem value="vector">Semantic only</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Hybrid also matches literal terms like product codes and SKUs that
            semantic search can miss.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Sources per answer</Label>
            <span className="text-sm tabular-nums text-muted-foreground">
              {aiConfig.ragTopK ?? 5}
            </span>
          </div>
          <Slider
            value={[aiConfig.ragTopK ?? 5]}
            min={1}
            max={20}
            step={1}
            onValueChange={([v]) => patchAiConfig({ ragTopK: v })}
          />
          <p className="text-xs text-muted-foreground">
            How many document passages the AI may pull into each answer. More
            sources = broader context but higher cost per reply.
          </p>
        </div>

        <p className="text-xs text-muted-foreground">
          Note: the legacy &quot;Knowledge&quot; text field in the Prompt
          section is still injected on every message. Documents here are
          retrieved on demand and answers cite them as sources.
        </p>
      </FormSection>

      {/* Document manager — immediate operations, NOT part of central Save. */}
      <FormSection
        title="Documents"
        description="PDF, DOCX, TXT or Markdown files, or public web pages. Changes here apply immediately."
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {documents.length} / {MAX_DOCUMENTS_PER_AGENT} documents
          </span>
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_ATTR}
              className="hidden"
              onChange={handleFileSelected}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setUrlDialogOpen(true)}
              disabled={atLimit}
            >
              <Link2 className="mr-1 h-4 w-4" /> Add URL
            </Button>
            <Button
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={atLimit || upload.isPending}
            >
              {upload.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-1 h-4 w-4" />
              )}
              Upload file
            </Button>
          </div>
        </div>
        {atLimit && (
          <p className="text-xs text-muted-foreground">
            Document limit reached. Delete a document to add another.
          </p>
        )}

        {documentsQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : documentsQuery.isError ? (
          <p className="rounded-md border border-destructive/50 p-4 text-sm text-destructive">
            Failed to load documents. Refresh the page to try again.
          </p>
        ) : documents.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            No documents yet. Upload a file or add a web page to give this
            agent a searchable knowledge base.
          </p>
        ) : (
          <TooltipProvider>
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Chunks</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead className="w-[90px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.map((doc) => {
                    const processing = isDocumentProcessing(doc);
                    const reindexing =
                      reindex.isPending && reindex.variables === doc.id;
                    return (
                      <TableRow key={doc.id}>
                        <TableCell className="max-w-[240px]">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-medium" title={doc.name}>
                              {doc.name}
                            </span>
                            {doc.sourceType === 'URL' && doc.sourceUrl && (
                              <a
                                href={doc.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 text-muted-foreground hover:text-foreground"
                                aria-label={`Open source page for ${doc.name}`}
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <StatusBadge doc={doc} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {doc.chunkCount.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {doc.totalTokens.toLocaleString()}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatDate(doc.createdAt)}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleReindex(doc)}
                                  disabled={processing || reindexing}
                                  aria-label={`Re-index ${doc.name}`}
                                >
                                  <RefreshCw
                                    className={`h-4 w-4 ${reindexing ? 'animate-spin' : ''}`}
                                  />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                Re-index with the current chunking strategy
                              </TooltipContent>
                            </Tooltip>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-destructive hover:text-destructive"
                                  aria-label={`Delete ${doc.name}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    Delete &quot;{doc.name}&quot;?
                                  </AlertDialogTitle>
                                  <AlertDialogDescription>
                                    The document and all its indexed passages
                                    will be removed. The AI will no longer be
                                    able to answer from it. This cannot be
                                    undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDelete(doc)}
                                    className="bg-destructive text-white hover:bg-destructive/90"
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </TooltipProvider>
        )}
      </FormSection>

      {/* Add-URL dialog */}
      <Dialog open={urlDialogOpen} onOpenChange={setUrlDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a web page</DialogTitle>
            <DialogDescription>
              The page&apos;s text content is fetched once and indexed. Use
              Re-index later to pick up changes to the page.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="kb-url" className="text-sm font-medium">
                URL
              </Label>
              <Input
                id="kb-url"
                value={urlValue}
                onChange={(e) => setUrlValue(e.target.value)}
                placeholder="https://example.com/help/pricing"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleIngestUrl();
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="kb-url-name" className="text-sm font-medium">
                Name{' '}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Input
                id="kb-url-name"
                value={urlName}
                onChange={(e) => setUrlName(e.target.value)}
                placeholder="Defaults to the page title"
                maxLength={255}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setUrlDialogOpen(false)}
              disabled={ingestUrl.isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleIngestUrl} disabled={ingestUrl.isPending}>
              {ingestUrl.isPending && (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              )}
              Add page
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
