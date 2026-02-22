'use client';

import { useState } from 'react';
import {
  Settings,
  User,
  MessageSquare,
  Type,
  Bot,
  Zap,
  Headphones,
  UserCheck,
} from 'lucide-react';
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
import { ImageUpload } from '../image-upload';

const chatTabs = [
  { id: 'header', label: 'Header', icon: <Settings className="h-4 w-4" /> },
  { id: 'avatars', label: 'Avatars', icon: <User className="h-4 w-4" /> },
  { id: 'messages', label: 'Messages', icon: <MessageSquare className="h-4 w-4" /> },
  { id: 'typography', label: 'Typography', icon: <Type className="h-4 w-4" /> },
];

const FONT_OPTIONS = [
  { value: 'Inter, system-ui, sans-serif', label: 'Inter' },
  {
    value: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    label: 'System UI',
  },
  { value: '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif', label: 'Segoe UI' },
  {
    value: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
    label: 'Roboto',
  },
  { value: '"Open Sans", Arial, sans-serif', label: 'Open Sans' },
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
];

const BOT_AVATAR_TYPES = [
  { value: 'robot', label: 'Robot', icon: <Bot className="h-4 w-4" /> },
  { value: 'machine', label: 'Machine', icon: <Settings className="h-4 w-4" /> },
  { value: 'bot', label: 'Bot', icon: <Zap className="h-4 w-4" /> },
  { value: 'support', label: 'Support', icon: <Headphones className="h-4 w-4" /> },
  { value: 'custom', label: 'Custom Image', icon: <User className="h-4 w-4" /> },
];

const USER_AVATAR_TYPES = [
  { value: 'user', label: 'User', icon: <User className="h-4 w-4" /> },
  { value: 'custom', label: 'Custom', icon: <UserCheck className="h-4 w-4" /> },
];

const AVATAR_SHAPES = [
  { value: 'circle', label: 'Circle' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'square', label: 'Square' },
];

export function ChatSettings() {
  const { agent, themeData, updateThemeData } = useAgentEditor();
  const [activeTab, setActiveTab] = useState('header');

  const renderHeaderSettings = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-3 items-center gap-4">
        <Label className="text-sm font-medium">Header Title</Label>
        <Input
          value={themeData.header.title}
          onChange={(e) => updateThemeData('header.title', e.target.value)}
          placeholder="Chat Support"
          className="col-span-2"
        />
      </div>

      <div className="grid grid-cols-3 items-center gap-4">
        <Label className="text-sm font-medium">Header Subtitle</Label>
        <Input
          value={themeData.header.subtitle ?? ''}
          onChange={(e) =>
            updateThemeData('header.subtitle', e.target.value || undefined)
          }
          placeholder="We're here to help"
          className="col-span-2"
        />
      </div>

      <div className="grid grid-cols-3 items-center gap-4">
        <Label className="text-sm font-medium">Show Logo</Label>
        <div className="col-span-2">
          <Switch
            checked={themeData.header.showLogo}
            onCheckedChange={(checked) => updateThemeData('header.showLogo', checked)}
          />
        </div>
      </div>

      {themeData.header.showLogo && (
        <div className="grid grid-cols-3 items-start gap-4">
          <Label className="pt-2 text-sm font-medium">Company Logo</Label>
          <div className="col-span-2">
            <ImageUpload
              value={themeData.header.logoUrl}
              onUpload={(url) => updateThemeData('header.logoUrl', url)}
              onRemove={() => updateThemeData('header.logoUrl', undefined)}
              agentId={agent.id}
              purpose="header-logo"
              previewShape="circle"
              hint="Recommended: 40x40px or larger. Displayed as circle."
            />
          </div>
        </div>
      )}

      <ColorPicker
        label="Header Background Color"
        value={themeData.header.backgroundColor}
        onChange={(color) => updateThemeData('header.backgroundColor', color)}
        className="col-span-2"
      />

      <ColorPicker
        label="Header Text Color"
        value={themeData.header.textColor}
        onChange={(color) => updateThemeData('header.textColor', color)}
        className="col-span-2"
      />

      <ColorPicker
        label="Subtitle Color"
        value={themeData.header.subtitleColor}
        onChange={(color) => updateThemeData('header.subtitleColor', color)}
        className="col-span-2"
      />
    </div>
  );

  const renderAvatarSettings = () => (
    <div className="space-y-6">
      <FormSection title="Bot Avatar" description="Configure the bot's avatar appearance">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Avatar Type</Label>
            <Select
              value={themeData.botAvatar.type}
              onValueChange={(val) => updateThemeData('botAvatar.type', val)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BOT_AVATAR_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    <span className="flex items-center gap-2">
                      {t.icon}
                      {t.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Avatar Shape</Label>
            <Select
              value={themeData.botAvatar.shape}
              onValueChange={(val) => updateThemeData('botAvatar.shape', val)}
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

        {themeData.botAvatar.type === 'custom' && (
          <ImageUpload
            value={themeData.botAvatar.customImageUrl}
            onUpload={(url) => updateThemeData('botAvatar.customImageUrl', url)}
            onRemove={() => updateThemeData('botAvatar.customImageUrl', undefined)}
            agentId={agent.id}
            purpose="bot-avatar"
            label="Custom Avatar Image"
            previewShape="circle"
            hint="Recommended: 32x32px or larger. Displayed as circle."
          />
        )}

        <ColorPicker
          label="Avatar Background Color"
          value={themeData.botAvatar.backgroundColor}
          onChange={(color) => updateThemeData('botAvatar.backgroundColor', color)}
        />

        <ColorPicker
          label="Avatar Icon Color"
          value={themeData.botAvatar.color}
          onChange={(color) => updateThemeData('botAvatar.color', color)}
        />
      </FormSection>

      <FormSection title="User Avatar" description="Configure the user's avatar appearance">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Avatar Type</Label>
            <Select
              value={themeData.userAvatar.type}
              onValueChange={(val) => updateThemeData('userAvatar.type', val)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {USER_AVATAR_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    <span className="flex items-center gap-2">
                      {t.icon}
                      {t.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Avatar Shape</Label>
            <Select
              value={themeData.userAvatar.shape}
              onValueChange={(val) => updateThemeData('userAvatar.shape', val)}
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

        {themeData.userAvatar.type === 'custom' && (
          <ImageUpload
            value={themeData.userAvatar.customImageUrl}
            onUpload={(url) => updateThemeData('userAvatar.customImageUrl', url)}
            onRemove={() => updateThemeData('userAvatar.customImageUrl', undefined)}
            agentId={agent.id}
            purpose="user-avatar"
            label="Custom Avatar Image"
            previewShape="circle"
            hint="Recommended: 32x32px or larger. Displayed as circle."
          />
        )}

        <ColorPicker
          label="Avatar Background Color"
          value={themeData.userAvatar.backgroundColor}
          onChange={(color) => updateThemeData('userAvatar.backgroundColor', color)}
        />

        <ColorPicker
          label="Avatar Icon Color"
          value={themeData.userAvatar.color}
          onChange={(color) => updateThemeData('userAvatar.color', color)}
        />
      </FormSection>
    </div>
  );

  const renderMessageSettings = () => (
    <div className="space-y-6">
      <FormSection title="Chat Background">
        <ColorPicker
          label="Chat Area Background Color"
          value={themeData.body.backgroundColor}
          onChange={(color) => updateThemeData('body.backgroundColor', color)}
        />
      </FormSection>

      <FormSection title="User Messages">
        <div className="grid grid-cols-2 gap-4">
          <ColorPicker
            label="Background Color"
            value={themeData.userMessage.backgroundColor}
            onChange={(color) => updateThemeData('userMessage.backgroundColor', color)}
          />
          <ColorPicker
            label="Text Color"
            value={themeData.userMessage.textColor}
            onChange={(color) => updateThemeData('userMessage.textColor', color)}
          />
        </div>

        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Message Border Radius</Label>
          <div className="col-span-2 flex items-center gap-3">
            <Slider
              value={[themeData.userMessage.borderRadius]}
              onValueChange={(vals) =>
                updateThemeData('userMessage.borderRadius', vals[0] ?? themeData.userMessage.borderRadius)
              }
              min={0}
              max={24}
              step={1}
              className="flex-1"
            />
            <span className="w-10 text-right text-sm text-muted-foreground">
              {themeData.userMessage.borderRadius}px
            </span>
          </div>
        </div>
      </FormSection>

      <FormSection title="System Messages">
        <div className="grid grid-cols-2 gap-4">
          <ColorPicker
            label="Background Color"
            value={themeData.botMessage.backgroundColor}
            onChange={(color) => updateThemeData('botMessage.backgroundColor', color)}
          />
          <ColorPicker
            label="Text Color"
            value={themeData.botMessage.textColor}
            onChange={(color) => updateThemeData('botMessage.textColor', color)}
          />
        </div>

        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Message Border Radius</Label>
          <div className="col-span-2 flex items-center gap-3">
            <Slider
              value={[themeData.botMessage.borderRadius]}
              onValueChange={(vals) =>
                updateThemeData('botMessage.borderRadius', vals[0] ?? themeData.botMessage.borderRadius)
              }
              min={0}
              max={24}
              step={1}
              className="flex-1"
            />
            <span className="w-10 text-right text-sm text-muted-foreground">
              {themeData.botMessage.borderRadius}px
            </span>
          </div>
        </div>

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
          <ColorPicker
            label="Timestamp Text Color"
            value={themeData.timestamps.color}
            onChange={(color) => updateThemeData('timestamps.color', color)}
          />
        )}
      </FormSection>

      <FormSection title="Input Area">
        <ColorPicker
          label="Input Background Color"
          value={themeData.input.backgroundColor}
          onChange={(color) => updateThemeData('input.backgroundColor', color)}
        />

        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Placeholder Text</Label>
          <Input
            value={themeData.input.placeholderText}
            onChange={(e) => updateThemeData('input.placeholderText', e.target.value)}
            placeholder="Type your message..."
            className="col-span-2"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <ColorPicker
            label="Text Color"
            value={themeData.input.textColor}
            onChange={(color) => updateThemeData('input.textColor', color)}
          />
          <ColorPicker
            label="Send Button Color"
            value={themeData.sendButton.backgroundColor}
            onChange={(color) => updateThemeData('sendButton.backgroundColor', color)}
          />
        </div>

        <ColorPicker
          label="Send Button Icon Color"
          value={themeData.sendButton.iconColor}
          onChange={(color) => updateThemeData('sendButton.iconColor', color)}
        />

        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Input Border Radius</Label>
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

        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Send Button Border Radius</Label>
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

  const renderTypographySettings = () => (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label className="text-sm font-medium">Font Family</Label>
        <Select
          value={themeData.typography.fontFamily}
          onValueChange={(val) => updateThemeData('typography.fontFamily', val)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FONT_OPTIONS.map((font) => (
              <SelectItem key={font.value} value={font.value}>
                <span style={{ fontFamily: font.value }}>{font.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-sm font-medium">Default Font Size (px)</Label>
          <Input
            type="number"
            value={themeData.typography.baseFontSize}
            onChange={(e) => {
              const val = parseInt(e.target.value);
              updateThemeData('typography.baseFontSize', Number.isNaN(val) ? 14 : Math.min(24, Math.max(10, val)));
            }}
            min={10}
            max={24}
          />
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <FormSection
        title="Chat Interface"
        description="Configure the chat window appearance and layout"
      >
        <TabGroup
          tabs={chatTabs}
          value={activeTab}
          onChange={setActiveTab}
          aria-label="Chat interface section"
        />

        {activeTab === 'header' && renderHeaderSettings()}
        {activeTab === 'avatars' && renderAvatarSettings()}
        {activeTab === 'messages' && renderMessageSettings()}
        {activeTab === 'typography' && renderTypographySettings()}
      </FormSection>
    </div>
  );
}
