'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { X, Plus } from 'lucide-react';
import { useAgentEditor } from '../agent-editor-context';
import { useProfile } from '@/hooks/use-profile';

function normalizeDomain(s: string) {
  return s
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*/, '')
    .replace(/\/$/, '');
}

function isValidDomain(s: string) {
  return /^(localhost(?::\d+)?|\d+\.\d+\.\d+\.\d+|[a-z0-9.-]+(?::\d+)?)$/.test(
    s,
  );
}

export function IntegrationSettings() {
  const { profile } = useProfile();
  const { formData, updateFormData } = useAgentEditor();
  const [newDomain, setNewDomain] = useState('');

  const isAdmin =
    profile?.role === 'SUPER_ADMIN' || profile?.role === 'ADMIN';

  if (!isAdmin) return null;

  const domains = formData.allowedDomains;

  const addDomains = (input: string) => {
    const parts = input
      .split(/[\s,]+/g)
      .map(normalizeDomain)
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...domains];
    for (const p of parts) {
      if (!isValidDomain(p)) continue;
      if (!next.includes(p)) next.push(p);
    }
    updateFormData('allowedDomains', next);
    setNewDomain('');
  };

  const removeDomain = (d: string) => {
    updateFormData(
      'allowedDomains',
      domains.filter((x) => x !== d),
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Integration</h3>
        <p className="text-sm text-muted-foreground">
          Webhooks and external connections
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-sm font-medium">Webhook URL</Label>
          <Input
            value={formData.webhookUrl}
            onChange={(e) => updateFormData('webhookUrl', e.target.value)}
            placeholder="https://your-api.com/webhook"
          />
          <p className="text-xs text-muted-foreground">
            This URL will receive POST requests when users send messages
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Allowed Domains</Label>
          <div className="flex gap-2">
            <Input
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addDomains(newDomain);
                }
              }}
              placeholder="example.com"
            />
            <Button
              type="button"
              onClick={() => addDomains(newDomain)}
              size="sm"
            >
              <Plus className="mr-1 h-4 w-4" /> Add
            </Button>
          </div>
          {domains.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {domains.map((d) => (
                <span
                  key={d}
                  className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs"
                >
                  {d}
                  <button
                    type="button"
                    onClick={() => removeDomain(d)}
                    className="ml-1 rounded p-0.5 text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground"
                    aria-label={`Remove ${d}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Enter a domain and press Enter or click Add. Supports ports
            (e.g., localhost:3001).
          </p>
        </div>
      </div>
    </div>
  );
}
