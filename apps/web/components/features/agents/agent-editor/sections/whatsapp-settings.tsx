'use client';

import { useState } from 'react';
import {
  Loader2,
  Copy,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  Plug,
} from 'lucide-react';
import { toast } from 'sonner';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { apiUrl } from '@/config/api';
import { usePermissions } from '@/hooks/use-permissions';
import {
  useWhatsappChannel,
  useConnectWhatsappChannel,
  useUpdateWhatsappChannel,
  useDisconnectWhatsappChannel,
  type WhatsappChannel,
} from '@/hooks/use-whatsapp-channel';
import { useAgentEditor } from '../agent-editor-context';
import { ToggleRow } from '../toggle-row';

const STATUS_BADGE: Record<
  WhatsappChannel['status'],
  { label: string; variant: 'default' | 'secondary' | 'destructive' }
> = {
  CONNECTED: { label: 'Connected', variant: 'default' },
  PENDING: { label: 'Pending', variant: 'secondary' },
  DISCONNECTED: { label: 'Disconnected', variant: 'secondary' },
  ERROR: { label: 'Error', variant: 'destructive' },
};

interface ConnectFields {
  displayPhone: string;
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
  verifiedName: string;
}

const EMPTY_FIELDS: ConnectFields = {
  displayPhone: '',
  phoneNumberId: '',
  wabaId: '',
  accessToken: '',
  verifiedName: '',
};

export function WhatsappSettings() {
  const { can } = usePermissions();
  const { agent } = useAgentEditor();

  const isAdmin = can('WhatsappChannel:Read');

  const channelQuery = useWhatsappChannel(agent.id);
  const connect = useConnectWhatsappChannel(agent.id);
  const update = useUpdateWhatsappChannel(agent.id);
  const disconnect = useDisconnectWhatsappChannel(agent.id);

  const [fields, setFields] = useState<ConnectFields>(EMPTY_FIELDS);

  // Connecting a number stores an access token — gate to admins like the
  // Integration section.
  if (!isAdmin) return null;

  const webhookUrl = apiUrl('/public/whatsapp/webhook');

  const setField = (key: keyof ConnectFields, value: string) =>
    setFields((prev) => ({ ...prev, [key]: value }));

  const copy = (value: string, label: string) => {
    void navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  };

  const handleConnect = () => {
    if (
      !fields.displayPhone.trim() ||
      !fields.phoneNumberId.trim() ||
      !fields.wabaId.trim() ||
      !fields.accessToken.trim()
    ) {
      toast.error('Display number, Phone number ID, WABA ID and token are required.');
      return;
    }
    connect.mutate(
      {
        displayPhone: fields.displayPhone.trim(),
        phoneNumberId: fields.phoneNumberId.trim(),
        wabaId: fields.wabaId.trim(),
        accessToken: fields.accessToken.trim(),
        verifiedName: fields.verifiedName.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success('WhatsApp number connected');
          setFields(EMPTY_FIELDS);
        },
        onError: (err) => toast.error(err.message || 'Failed to connect'),
      },
    );
  };

  const handleDisconnect = () => {
    disconnect.mutate(undefined, {
      onSuccess: () => toast.success('WhatsApp number disconnected'),
      onError: (err) => toast.error(err.message || 'Failed to disconnect'),
    });
  };

  const handleToggleVoice = (enabled: boolean) => {
    update.mutate(
      { voiceReplyEnabled: enabled },
      {
        onSuccess: () =>
          toast.success(
            enabled ? 'Voice replies enabled' : 'Voice replies disabled',
          ),
        onError: (err) => toast.error(err.message || 'Failed to update'),
      },
    );
  };

  const channel = channelQuery.data;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-1.5">
          <h3 className="text-lg font-semibold">WhatsApp</h3>
          <InfoTooltip
            label="WhatsApp"
            content={
              <p>
                The agent answers on WhatsApp with the{' '}
                <strong>same prompt and knowledge</strong> it uses in the website
                widget. There is nothing separate to configure.
              </p>
            }
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Let customers chat with this agent on WhatsApp.
        </p>
      </div>

      {/* Meta webhook callback URL — paste this into the Meta dashboard when
          configuring the WhatsApp webhook for your app. */}
      <div className="space-y-2 rounded-lg border bg-muted/20 p-4">
        <div className="flex items-center gap-1.5">
          <Label className="text-sm font-medium">Webhook callback URL</Label>
          <InfoTooltip
            label="Webhook callback URL"
            content={
              <>
                <p>
                  In the Meta dashboard, go to <strong>App → WhatsApp →
                  Configuration</strong> and set this as the Callback URL.
                </p>
                <p>The verify token is configured on the server, not here.</p>
              </>
            }
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Paste this into the Meta dashboard.
        </p>
        <div className="flex gap-2">
          <Input readOnly value={webhookUrl} className="font-mono text-xs" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => copy(webhookUrl, 'Callback URL')}
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {channelQuery.isLoading ? (
        <div className="space-y-3 rounded-lg border p-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
      ) : channel ? (
        <ConnectedCard
          channel={channel}
          disconnecting={disconnect.isPending}
          onDisconnect={handleDisconnect}
          onCopy={copy}
          onToggleVoiceReply={handleToggleVoice}
          voiceToggling={update.isPending}
        />
      ) : (
        <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
          <div className="flex items-center gap-2">
            <Plug className="h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              Paste these from the Meta dashboard.
            </p>
            <InfoTooltip
              label="WhatsApp credentials"
              content={
                <>
                  <p>
                    Find these in the Meta dashboard under{' '}
                    <strong>App → WhatsApp → API Setup</strong>.
                  </p>
                  <p>
                    Self-serve onboarding via Embedded Signup is coming later. For now
                    these are entered by hand.
                  </p>
                </>
              }
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Display number</Label>
            <Input
              value={fields.displayPhone}
              onChange={(e) => setField('displayPhone', e.target.value)}
              placeholder="+1 555 010 1234"
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Phone number ID</Label>
            <Input
              value={fields.phoneNumberId}
              onChange={(e) => setField('phoneNumberId', e.target.value)}
              placeholder="1234567890"
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">WhatsApp Business Account ID</Label>
            <Input
              value={fields.wabaId}
              onChange={(e) => setField('wabaId', e.target.value)}
              placeholder="1098765432"
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Access token</Label>
            <Input
              type="password"
              value={fields.accessToken}
              onChange={(e) => setField('accessToken', e.target.value)}
              placeholder="EAAG..."
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">
              Stored encrypted. Never shown again after saving.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">
              Business display name{' '}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              value={fields.verifiedName}
              onChange={(e) => setField('verifiedName', e.target.value)}
              placeholder="Acme Support"
              autoComplete="off"
            />
          </div>

          <Button type="button" onClick={handleConnect} disabled={connect.isPending}>
            {connect.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Connecting…
              </>
            ) : (
              'Connect WhatsApp'
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

function ConnectedCard({
  channel,
  disconnecting,
  onDisconnect,
  onCopy,
  onToggleVoiceReply,
  voiceToggling,
}: {
  channel: WhatsappChannel;
  disconnecting: boolean;
  onDisconnect: () => void;
  onCopy: (value: string, label: string) => void;
  onToggleVoiceReply: (enabled: boolean) => void;
  voiceToggling: boolean;
}) {
  const badge = STATUS_BADGE[channel.status];

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {channel.status === 'CONNECTED' ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          ) : channel.status === 'ERROR' ? (
            <AlertTriangle className="h-5 w-5 text-destructive" />
          ) : (
            <Plug className="h-5 w-5 text-muted-foreground" />
          )}
          <div>
            <p className="text-sm font-medium">{channel.displayPhone}</p>
            {channel.verifiedName && (
              <p className="text-xs text-muted-foreground">
                {channel.verifiedName}
              </p>
            )}
          </div>
        </div>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>

      <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
        <div className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2">
          <dt className="text-muted-foreground">Phone number ID</dt>
          <dd className="flex items-center gap-1 font-mono">
            {channel.phoneNumberId}
            <button
              type="button"
              onClick={() => onCopy(channel.phoneNumberId, 'Phone number ID')}
              className="cursor-pointer rounded p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="Copy phone number ID"
            >
              <Copy className="h-3 w-3" />
            </button>
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2">
          <dt className="text-muted-foreground">WABA ID</dt>
          <dd className="font-mono">{channel.wabaId}</dd>
        </div>
      </dl>

      {/* Voice-reply toggle: when on, the agent answers an inbound voice note with
          a voice note (TTS). Text messages always get a text reply. */}
      <div className="rounded-md border p-3">
        <ToggleRow
          id="whatsappVoiceReply"
          label="Reply with a voice note"
          info={
            <p>
              When a customer sends a voice note, answer with a voice note instead of
              text. Typed messages still get text replies either way.
            </p>
          }
          checked={channel.voiceReplyEnabled}
          disabled={voiceToggling}
          onChange={onToggleVoiceReply}
        />
      </div>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" size="sm" disabled={disconnecting}>
            {disconnecting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Disconnecting…
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4" /> Disconnect
              </>
            )}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect WhatsApp?</AlertDialogTitle>
            <AlertDialogDescription>
              This agent will stop receiving and replying to WhatsApp messages on{' '}
              {channel.displayPhone}. You can reconnect later by entering the
              number details again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDisconnect}>
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
