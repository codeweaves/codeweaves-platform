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
  { id: 'header', label: 'Header', icon: <Settings className="w-4 h-4" /> },
  { id: 'avatars', label: 'Avatars', icon: <User className="w-4 h-4" /> },
  { id: 'messages', label: 'Messages', icon: <MessageSquare className="w-4 h-4" /> },
  { id: 'typography', label: 'Typography', icon: <Type className="w-4 h-4" /> },
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
  { value: 'robot', label: 'Robot', icon: <Bot className="w-4 h-4" /> },
  { value: 'machine', label: 'Machine', icon: <Settings className="w-4 h-4" /> },
  { value: 'bot', label: 'Bot', icon: <Zap className="w-4 h-4" /> },
  { value: 'support', label: 'Support', icon: <Headphones className="w-4 h-4" /> },
  { value: 'custom', label: 'Custom Image', icon: <User className="w-4 h-4" /> },
];

const USER_AVATAR_TYPES = [
  { value: 'user', label: 'User', icon: <User className="w-4 h-4" /> },
  { value: 'custom', label: 'Custom', icon: <UserCheck className="w-4 h-4" /> },
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
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4 items-center">
          <Label className="text-sm font-medium text-gray-700">Header Title</Label>
          <Input
            value={themeData.header.title}
            onChange={(e) => updateThemeData('header.title', e.target.value)}
            placeholder="Chat Support"
            className="col-span-2 rounded-md focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="grid grid-cols-3 gap-4 items-center">
          <Label className="text-sm font-medium text-gray-700">Header Subtitle</Label>
          <Input
            value={themeData.header.subtitle ?? ''}
            onChange={(e) => updateThemeData('header.subtitle', e.target.value || undefined)}
            placeholder="We're here to help"
            className="col-span-2 rounded-md focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 items-start">
        <Label className="text-sm font-medium text-gray-700 pt-2">Company Logo</Label>
        <div className="col-span-2">
          <ImageUpload
            value={themeData.header.logoUrl}
            onUpload={(url) => { updateThemeData('header.logoUrl', url); updateThemeData('header.showLogo', true); }}
            onRemove={() => { updateThemeData('header.logoUrl', undefined); updateThemeData('header.showLogo', false); }}
            agentId={agent.id}
            purpose="header-logo"
            previewShape="circle"
            hint="Upload an image file. Recommended size: 40x40px or larger. The logo will be displayed as a circle."
          />
        </div>
      </div>

      <ColorPicker
        label="Header Background Color"
        value={themeData.header.backgroundColor}
        onChange={(color) => updateThemeData('header.backgroundColor', color)}
        id="headerBg"
      />

      <ColorPicker
        label="Header Text Color"
        value={themeData.header.textColor}
        onChange={(color) => updateThemeData('header.textColor', color)}
        id="headerTextColor"
      />

      <ColorPicker
        label="Subtitle Color"
        value={themeData.header.subtitleColor}
        onChange={(color) => updateThemeData('header.subtitleColor', color)}
        id="subtitleColor"
      />

      <div className="grid grid-cols-3 gap-4 items-center">
        <Label className="text-sm font-medium text-gray-700">Border Radius (px)</Label>
        <Input
          type="number"
          value={themeData.header.borderRadius}
          onChange={(e) => updateThemeData('header.borderRadius', parseInt(e.target.value) || 14)}
          min={0}
          max={50}
          className="col-span-2 rounded-md focus:ring-2 focus:ring-blue-500"
        />
      </div>
    </div>
  );

  const renderAvatarSettings = () => (
    <div className="space-y-6">
      <FormSection title="Bot Avatar" className="p-6 rounded-lg border border-gray-200">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium text-gray-700">Show bot avatar in messages</Label>
          <Switch
            checked={themeData.botAvatar.show ?? false}
            onCheckedChange={(checked) => updateThemeData('botAvatar.show', checked)}
          />
        </div>

        {(themeData.botAvatar.show ?? false) && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium text-gray-700">Avatar Type</Label>
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
                <Label className="text-sm font-medium text-gray-700">Avatar Shape</Label>
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
              <div className="space-y-3">
                <Label className="text-sm font-medium text-gray-700">Custom Avatar Image</Label>
                <ImageUpload
                  value={themeData.botAvatar.customImageUrl}
                  onUpload={(url) => updateThemeData('botAvatar.customImageUrl', url)}
                  onRemove={() => updateThemeData('botAvatar.customImageUrl', undefined)}
                  agentId={agent.id}
                  purpose="bot-avatar"
                  previewShape="circle"
                  hint="Upload an image file. Recommended size: 32x32px or larger. The image will be displayed as a circle."
                />
              </div>
            )}

            <ColorPicker
              label="Avatar Background Color"
              value={themeData.botAvatar.backgroundColor}
              onChange={(color) => updateThemeData('botAvatar.backgroundColor', color)}
              id="botAvatarBg"
            />

            <ColorPicker
              label="Avatar Icon Color"
              value={themeData.botAvatar.color}
              onChange={(color) => updateThemeData('botAvatar.color', color)}
              id="botAvatarColor"
            />
          </>
        )}
      </FormSection>

      <FormSection title="User Avatar" className="p-6 rounded-lg border border-gray-200">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium text-gray-700">Show user avatar in messages</Label>
          <Switch
            checked={themeData.userAvatar.show ?? false}
            onCheckedChange={(checked) => updateThemeData('userAvatar.show', checked)}
          />
        </div>

        {(themeData.userAvatar.show ?? false) && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium text-gray-700">Avatar Type</Label>
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
                <Label className="text-sm font-medium text-gray-700">Avatar Shape</Label>
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
              <div className="space-y-3">
                <Label className="text-sm font-medium text-gray-700">Custom Avatar Image</Label>
                <ImageUpload
                  value={themeData.userAvatar.customImageUrl}
                  onUpload={(url) => updateThemeData('userAvatar.customImageUrl', url)}
                  onRemove={() => updateThemeData('userAvatar.customImageUrl', undefined)}
                  agentId={agent.id}
                  purpose="user-avatar"
                  previewShape="circle"
                  hint="Upload an image file. Recommended size: 32x32px or larger. The image will be displayed as a circle."
                />
              </div>
            )}

            <ColorPicker
              label="Avatar Background Color"
              value={themeData.userAvatar.backgroundColor}
              onChange={(color) => updateThemeData('userAvatar.backgroundColor', color)}
              id="userAvatarBg"
            />

            <ColorPicker
              label="Avatar Icon Color"
              value={themeData.userAvatar.color}
              onChange={(color) => updateThemeData('userAvatar.color', color)}
              id="userAvatarColor"
            />
          </>
        )}
      </FormSection>
    </div>
  );

  const renderMessageSettings = () => (
    <div className="space-y-6">
      <FormSection title="Chat Background" className="p-6 rounded-lg border border-gray-200">
        <ColorPicker
          label="Chat Area Background Color"
          value={themeData.body.backgroundColor}
          onChange={(color) => updateThemeData('body.backgroundColor', color)}
          id="chatBodyBg"
        />
      </FormSection>

      <FormSection title="User Messages" className="p-6 rounded-lg border border-gray-200">
        <div className="grid grid-cols-2 gap-4">
          <ColorPicker
            label="Background Color"
            value={themeData.userMessage.backgroundColor}
            onChange={(color) => updateThemeData('userMessage.backgroundColor', color)}
            id="userMessageBg"
          />
          <ColorPicker
            label="Text Color"
            value={themeData.userMessage.textColor}
            onChange={(color) => updateThemeData('userMessage.textColor', color)}
            id="userMessageTextColor"
          />
        </div>

        <div className="grid grid-cols-3 gap-4 items-center">
          <Label className="text-sm font-medium text-gray-700">Message Border Radius (px)</Label>
          <Input
            type="number"
            value={themeData.userMessage.borderRadius}
            onChange={(e) => updateThemeData('userMessage.borderRadius', parseInt(e.target.value) || 14)}
            min={0}
            max={50}
            className="col-span-2 rounded-md focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </FormSection>

      <FormSection title="System Messages" className="p-6 rounded-lg border border-gray-200">
        <div className="grid grid-cols-2 gap-4">
          <ColorPicker
            label="Background Color"
            value={themeData.botMessage.backgroundColor}
            onChange={(color) => updateThemeData('botMessage.backgroundColor', color)}
            id="systemMessageBg"
          />
          <ColorPicker
            label="Text Color"
            value={themeData.botMessage.textColor}
            onChange={(color) => updateThemeData('botMessage.textColor', color)}
            id="systemMessageTextColor"
          />
        </div>

        <div className="grid grid-cols-3 gap-4 items-center">
          <Label className="text-sm font-medium text-gray-700">Message Border Radius (px)</Label>
          <Input
            type="number"
            value={themeData.botMessage.borderRadius}
            onChange={(e) => updateThemeData('botMessage.borderRadius', parseInt(e.target.value) || 14)}
            min={0}
            max={50}
            className="col-span-2 rounded-md focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center justify-between p-4 bg-white rounded-lg border">
          <div>
            <Label className="text-sm font-medium text-gray-700">Show Timestamps</Label>
            <p className="text-xs text-gray-500 mt-1">Display message timestamps</p>
          </div>
          <Switch
            checked={themeData.timestamps.show}
            onCheckedChange={(checked) => updateThemeData('timestamps.show', checked)}
          />
        </div>

        {themeData.timestamps.show && (
          <ColorPicker
            label="Timestamp Text Color"
            value={themeData.timestamps.color}
            onChange={(color) => updateThemeData('timestamps.color', color)}
            id="timestampColor"
          />
        )}
      </FormSection>

      <FormSection title="Input Area" className="p-6 rounded-lg border">
        <div className="space-y-4">
          <ColorPicker
            label="Input Background Color"
            value={themeData.input.backgroundColor}
            onChange={(color) => updateThemeData('input.backgroundColor', color)}
            id="inputBg"
          />

          <div className="grid grid-cols-3 gap-4 items-center">
            <Label className="text-sm font-medium text-gray-700">Placeholder Text</Label>
            <Input
              value={themeData.input.placeholderText}
              onChange={(e) => updateThemeData('input.placeholderText', e.target.value)}
              placeholder="Type your message..."
              className="col-span-2 rounded-md focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <ColorPicker
              label="Text Color"
              value={themeData.input.textColor}
              onChange={(color) => updateThemeData('input.textColor', color)}
              id="inputTextColor"
            />
            <ColorPicker
              label="Send Button Color"
              value={themeData.sendButton.backgroundColor}
              onChange={(color) => updateThemeData('sendButton.backgroundColor', color)}
              id="sendButtonBg"
            />
          </div>

          <ColorPicker
            label="Send Button Icon Color"
            value={themeData.sendButton.iconColor}
            onChange={(color) => updateThemeData('sendButton.iconColor', color)}
            id="sendButtonIconColor"
          />

          <div className="grid grid-cols-3 gap-4 items-center">
            <Label className="text-sm font-medium text-gray-700">Input Border Radius (px)</Label>
            <Input
              type="number"
              value={themeData.input.borderRadius}
              onChange={(e) => updateThemeData('input.borderRadius', parseInt(e.target.value) || 14)}
              min={0}
              max={50}
              className="col-span-2 rounded-md focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-3 gap-4 items-center">
            <Label className="text-sm font-medium text-gray-700">Send Button Border Radius (px)</Label>
            <Input
              type="number"
              value={themeData.sendButton.borderRadius}
              onChange={(e) => updateThemeData('sendButton.borderRadius', parseInt(e.target.value) || 14)}
              min={0}
              max={50}
              className="col-span-2 rounded-md focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </FormSection>
    </div>
  );

  const renderTypographySettings = () => (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label className="text-sm font-medium text-gray-700">Font Family</Label>
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
          <Label className="text-sm font-medium text-gray-700">Default Font Size (px)</Label>
          <Input
            type="number"
            value={themeData.typography.baseFontSize}
            onChange={(e) => {
              const val = parseInt(e.target.value);
              updateThemeData('typography.baseFontSize', Number.isNaN(val) ? 14 : Math.min(24, Math.max(10, val)));
            }}
            min={10}
            max={24}
            className="focus:ring-2 focus:ring-blue-500"
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
