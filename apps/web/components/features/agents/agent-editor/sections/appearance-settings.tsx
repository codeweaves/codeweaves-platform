'use client';

import { useState, useMemo } from 'react';
import { User, Bot } from 'lucide-react';
import type { WidgetTheme } from '@repo/validation';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAgentEditor } from '../agent-editor-context';
import { FormSection } from '../form-section';
import { ColorPicker } from '../color-picker';
import { TabGroup } from '../tab-group';

const AVATAR_TYPES = [
  { value: 'robot', label: 'Robot' },
  { value: 'machine', label: 'Machine' },
  { value: 'bot', label: 'Bot' },
  { value: 'support', label: 'Support' },
  { value: 'custom', label: 'Custom Image' },
  { value: 'user', label: 'User' },
];

const AVATAR_SHAPES = [
  { value: 'circle', label: 'Circle' },
  { value: 'square', label: 'Square' },
  { value: 'rounded', label: 'Rounded' },
];

const TIMESTAMP_FORMAT_OPTIONS = [
  { value: '12h', label: '12-hour' },
  { value: '24h', label: '24-hour' },
];

/** Renders message style + avatar controls for a given message role. */
function MessageControls({
  role,
  themeData,
  updateThemeData,
}: {
  role: 'user' | 'bot';
  themeData: WidgetTheme;
  updateThemeData: (path: string, value: unknown) => void;
}) {
  const messageKey = role === 'user' ? 'userMessage' : 'botMessage';
  const avatarKey = role === 'user' ? 'userAvatar' : 'botAvatar';
  const message = themeData[messageKey];
  const avatar = themeData[avatarKey];

  return (
    <>
      <FormSection title="Message Style" description="Background, text color, and corner rounding">
        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Background Color</Label>
          <ColorPicker
            value={message.backgroundColor}
            onChange={(color) => updateThemeData(`${messageKey}.backgroundColor`, color)}
            className="col-span-2"
          />
        </div>

        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Text Color</Label>
          <ColorPicker
            value={message.textColor}
            onChange={(color) => updateThemeData(`${messageKey}.textColor`, color)}
            className="col-span-2"
          />
        </div>

        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Border Radius</Label>
          <div className="col-span-2 flex items-center gap-3">
            <Slider
              value={[message.borderRadius]}
              onValueChange={(vals) =>
                updateThemeData(`${messageKey}.borderRadius`, vals[0] ?? message.borderRadius)
              }
              min={0}
              max={24}
              step={1}
              className="flex-1"
            />
            <span className="w-10 text-right text-sm text-muted-foreground">
              {message.borderRadius}px
            </span>
          </div>
        </div>
      </FormSection>

      <FormSection title="Avatar" description="Icon type, shape, and colors">
        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Type</Label>
          <div className="col-span-2">
            <Select
              value={avatar.type}
              onValueChange={(val) => updateThemeData(`${avatarKey}.type`, val)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AVATAR_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Shape</Label>
          <div className="col-span-2">
            <Select
              value={avatar.shape}
              onValueChange={(val) => updateThemeData(`${avatarKey}.shape`, val)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AVATAR_SHAPES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Background Color</Label>
          <ColorPicker
            value={avatar.backgroundColor}
            onChange={(color) => updateThemeData(`${avatarKey}.backgroundColor`, color)}
            className="col-span-2"
          />
        </div>

        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Icon Color</Label>
          <ColorPicker
            value={avatar.color}
            onChange={(color) => updateThemeData(`${avatarKey}.color`, color)}
            className="col-span-2"
          />
        </div>

        {avatar.type === 'custom' && (
          <div className="grid grid-cols-3 items-center gap-4">
            <Label className="text-sm font-medium">Custom Image URL</Label>
            <Input
              value={avatar.customImageUrl ?? ''}
              onChange={(e) =>
                updateThemeData(`${avatarKey}.customImageUrl`, e.target.value || undefined)
              }
              placeholder="https://example.com/avatar.png"
              className="col-span-2"
            />
          </div>
        )}
      </FormSection>
    </>
  );
}

export function AppearanceSettings() {
  const { themeData, updateThemeData } = useAgentEditor();
  const [messageTab, setMessageTab] = useState<'user' | 'bot'>('user');

  const messageTabs = useMemo(
    () => [
      { id: 'user', label: 'User Messages', icon: <User className="h-4 w-4" /> },
      { id: 'bot', label: 'Bot Messages', icon: <Bot className="h-4 w-4" /> },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Appearance</h3>
        <p className="text-sm text-muted-foreground">
          Message bubbles, avatars, chat body, timestamps, input field, and send button
        </p>
      </div>

      {/* User / Bot Messages TabGroup */}
      <div className="space-y-4">
        <TabGroup
          tabs={messageTabs}
          value={messageTab}
          onChange={(id) => setMessageTab(id as 'user' | 'bot')}
          aria-label="Message role"
        />
        <MessageControls role={messageTab} themeData={themeData} updateThemeData={updateThemeData} />
      </div>

      {/* Chat Body */}
      <FormSection title="Chat Body" description="Background color of the conversation area">
        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Background Color</Label>
          <ColorPicker
            value={themeData.body.backgroundColor}
            onChange={(color) => updateThemeData('body.backgroundColor', color)}
            className="col-span-2"
          />
        </div>
      </FormSection>

      {/* Timestamps */}
      <FormSection title="Timestamps" description="Show or hide message timestamps and their format">
        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Show Timestamps</Label>
          <div className="col-span-2">
            <Switch
              checked={themeData.timestamps.show}
              onCheckedChange={(checked) => updateThemeData('timestamps.show', checked)}
            />
          </div>
        </div>

        {themeData.timestamps.show && (
          <>
            <div className="grid grid-cols-3 items-center gap-4">
              <Label className="text-sm font-medium">Format</Label>
              <div className="col-span-2">
                <Select
                  value={themeData.timestamps.format}
                  onValueChange={(val) => updateThemeData('timestamps.format', val)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMESTAMP_FORMAT_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 items-center gap-4">
              <Label className="text-sm font-medium">Color</Label>
              <ColorPicker
                value={themeData.timestamps.color}
                onChange={(color) => updateThemeData('timestamps.color', color)}
                className="col-span-2"
              />
            </div>
          </>
        )}
      </FormSection>

      {/* Input Field */}
      <FormSection title="Input Field" description="Message input box styling">
        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Background Color</Label>
          <ColorPicker
            value={themeData.input.backgroundColor}
            onChange={(color) => updateThemeData('input.backgroundColor', color)}
            className="col-span-2"
          />
        </div>

        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Text Color</Label>
          <ColorPicker
            value={themeData.input.textColor}
            onChange={(color) => updateThemeData('input.textColor', color)}
            className="col-span-2"
          />
        </div>

        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Placeholder Text</Label>
          <Input
            value={themeData.input.placeholderText}
            onChange={(e) => updateThemeData('input.placeholderText', e.target.value)}
            placeholder="Type your message..."
            className="col-span-2"
          />
        </div>

        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Border Color</Label>
          <ColorPicker
            value={themeData.input.borderColor}
            onChange={(color) => updateThemeData('input.borderColor', color)}
            className="col-span-2"
          />
        </div>

        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Border Radius</Label>
          <div className="col-span-2 flex items-center gap-3">
            <Slider
              value={[themeData.input.borderRadius]}
              onValueChange={(vals) =>
                updateThemeData('input.borderRadius', vals[0] ?? themeData.input.borderRadius)
              }
              min={0}
              max={24}
              step={1}
              className="flex-1"
            />
            <span className="w-10 text-right text-sm text-muted-foreground">
              {themeData.input.borderRadius}px
            </span>
          </div>
        </div>
      </FormSection>

      {/* Send Button */}
      <FormSection title="Send Button" description="Send button colors and shape">
        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Background Color</Label>
          <ColorPicker
            value={themeData.sendButton.backgroundColor}
            onChange={(color) => updateThemeData('sendButton.backgroundColor', color)}
            className="col-span-2"
          />
        </div>

        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Hover Color</Label>
          <ColorPicker
            value={themeData.sendButton.hoverBackgroundColor}
            onChange={(color) => updateThemeData('sendButton.hoverBackgroundColor', color)}
            className="col-span-2"
          />
        </div>

        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Icon Color</Label>
          <ColorPicker
            value={themeData.sendButton.iconColor}
            onChange={(color) => updateThemeData('sendButton.iconColor', color)}
            className="col-span-2"
          />
        </div>

        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Border Radius</Label>
          <div className="col-span-2 flex items-center gap-3">
            <Slider
              value={[themeData.sendButton.borderRadius]}
              onValueChange={(vals) =>
                updateThemeData(
                  'sendButton.borderRadius',
                  vals[0] ?? themeData.sendButton.borderRadius,
                )
              }
              min={0}
              max={24}
              step={1}
              className="flex-1"
            />
            <span className="w-10 text-right text-sm text-muted-foreground">
              {themeData.sendButton.borderRadius}px
            </span>
          </div>
        </div>
      </FormSection>
    </div>
  );
}
