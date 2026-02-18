'use client';

import { Settings } from 'lucide-react';

export function BehaviorSettings() {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
      <Settings className="mb-4 h-10 w-10" />
      <p className="text-sm">
        Behavior settings will be available in the Theme Editor.
      </p>
    </div>
  );
}
