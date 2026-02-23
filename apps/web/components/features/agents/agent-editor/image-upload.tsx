'use client';

import { useState, useCallback, useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useApiClient } from '@/lib/api-client';

interface ImageUploadProps {
  value?: string;
  onUpload: (url: string) => void;
  onRemove: () => void;
  agentId: string;
  purpose: string;
  accept?: string;
  label?: string;
  hint?: string;
  previewShape?: 'circle' | 'square' | 'rounded';
  className?: string;
}

export function ImageUpload({
  value,
  onUpload,
  onRemove,
  agentId,
  purpose,
  accept = 'image/*',
  label,
  hint,
  previewShape = 'circle',
  className,
}: ImageUploadProps) {
  const api = useApiClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | undefined>(value);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shapeClass =
    previewShape === 'circle'
      ? 'rounded-full'
      : previewShape === 'rounded'
        ? 'rounded-lg'
        : 'rounded-none';

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      setError(null);
      const file = e.target.files?.[0];
      if (!file) return;

      // Optimistic preview
      const localUrl = URL.createObjectURL(file);
      setPreview(localUrl);

      try {
        setUploading(true);
        const result = await api.upload(
          `/agents/${agentId}/files/upload`,
          file,
          { purpose },
        );
        URL.revokeObjectURL(localUrl);
        setPreview(result.publicUrl);
        onUpload(result.publicUrl);
      } catch (err: unknown) {
        URL.revokeObjectURL(localUrl);
        setPreview(value);
        setError(
          err instanceof Error ? err.message : 'Upload failed',
        );
      } finally {
        setUploading(false);
        // Reset input so same file can be re-selected
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [api, agentId, purpose, value, onUpload],
  );

  const handleRemove = useCallback(() => {
    setPreview(undefined);
    setError(null);
    onRemove();
  }, [onRemove]);

  const displayUrl = preview || value;

  return (
    <div className={cn('space-y-3', className)}>
      {label && (
        <span className="text-sm font-medium">{label}</span>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleFileChange}
        className="block w-full cursor-pointer text-sm text-muted-foreground file:mr-4 file:cursor-pointer file:rounded-lg file:border-0 file:bg-primary/10 file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary hover:file:bg-primary/20"
      />

      {displayUrl && (
        <div className="flex items-center gap-3 rounded-lg border p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- preview uses dynamic blob/external URLs */}
          <img
            src={displayUrl}
            alt="Preview"
            className={cn('h-10 w-10 object-cover', shapeClass)}
          />
          <div className="flex-1">
            <span className="text-sm text-muted-foreground">Preview</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRemove}
            className="h-8 w-8 cursor-pointer text-destructive hover:text-destructive"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {uploading && (
        <p className="text-xs text-muted-foreground">Uploading…</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {hint && !error && !uploading && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
