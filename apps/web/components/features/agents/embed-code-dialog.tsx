"use client";

import { useState } from "react";
import { Code, Copy, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const WIDGET_URL =
  process.env.NEXT_PUBLIC_WIDGET_URL || "http://localhost:5173";

interface EmbedCodeDialogProps {
  publicId: string;
  /** When known and empty, the widget loads on no website, so no snippet is shown. */
  allowedDomains?: string[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
}

export function EmbedCodeDialog({
  publicId,
  allowedDomains,
  open,
  onOpenChange,
  trigger,
}: EmbedCodeDialogProps) {
  const [copied, setCopied] = useState(false);
  const needsDomain =
    allowedDomains !== undefined && allowedDomains.length === 0;

  const embedSnippet = `<script src="${WIDGET_URL}/${publicId}"></script>`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(embedSnippet);
    setCopied(true);
    toast.success("Embed code copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const isControlled = open !== undefined;

  return (
    <Dialog
      open={isControlled ? open : undefined}
      onOpenChange={isControlled ? onOpenChange : undefined}
    >
      {!isControlled && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button variant="outline" size="sm">
              <Code className="h-4 w-4" />
              Embed Code
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Embed Code</DialogTitle>
          <DialogDescription>
            Add this snippet to your website to display the chat widget.
          </DialogDescription>
        </DialogHeader>
        {needsDomain ? (
          <p className="rounded-lg bg-muted p-4 text-sm">
            Add at least one allowed domain in the agent&apos;s Integration
            settings first. The widget loads only on the domains you list.
          </p>
        ) : (
          <div className="flex items-stretch gap-2">
            <pre
              className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-muted p-4 text-sm [&::-webkit-scrollbar]:hidden"
              style={{ scrollbarWidth: "none" }}
            >
              <code>{embedSnippet}</code>
            </pre>
            <Button
              variant="outline"
              className="h-auto shrink-0 px-4"
              onClick={handleCopy}
              aria-label="Copy embed code"
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
