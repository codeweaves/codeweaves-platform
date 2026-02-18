'use client';

import { Palette } from 'lucide-react';

export function AppearanceSettings() {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
      <Palette className="mb-4 h-10 w-10" />
      <p className="text-sm">
        Appearance customization will be available in the Theme Editor.
      </p>
    </div>
  );
}
