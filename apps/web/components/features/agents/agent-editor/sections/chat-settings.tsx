'use client';

import { MessageCircle } from 'lucide-react';

export function ChatSettings() {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
      <MessageCircle className="mb-4 h-10 w-10" />
      <p className="text-sm">
        Chat interface settings will be available in the Theme Editor.
      </p>
    </div>
  );
}
