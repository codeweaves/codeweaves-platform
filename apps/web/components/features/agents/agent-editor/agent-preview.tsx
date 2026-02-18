'use client';

import { useMemo, useState } from 'react';
import type { PreviewFormData } from './agent-editor-context';
import { ChatWidgetSurface, type ChatWidgetMessage } from './chat-widget-surface';

export interface PreviewMessage {
  type: 'user' | 'system';
  text: string;
  timestamp: Date;
}

interface AgentPreviewProps {
  formData: PreviewFormData;
  messages: PreviewMessage[];
  onSendMessage: (message: string) => void;
}

export function AgentPreview({
  formData,
  messages,
  onSendMessage,
}: AgentPreviewProps) {
  const [isMinimized, setIsMinimized] = useState(true);
  const [isWindowMinimized, setIsWindowMinimized] = useState(false);
  const [showBubble, setShowBubble] = useState(true);

  const chatMessages: ChatWidgetMessage[] = useMemo(
    () =>
      messages.map((message, index) => ({
        id: `preview-${index}`,
        role: message.type === 'user' ? ('user' as const) : ('system' as const),
        text: message.text,
        timestamp: message.timestamp,
      })),
    [messages],
  );

  // Show typing only while waiting for a reply (last message is from user)
  const typing = Boolean(
    formData.typingIndicator &&
      messages.length > 0 &&
      messages[messages.length - 1]?.type === 'user',
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-gray-100 p-4">
        <h3 className="text-lg font-semibold text-gray-900">Live Preview</h3>
      </div>

      {/* Preview container */}
      <div className="scrollarea relative min-h-0 flex-1 overflow-y-auto bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="relative" style={{ minHeight: '100%' }}>
          <ChatWidgetSurface
            formData={formData}
            messages={chatMessages}
            isMinimized={isMinimized}
            onMinimizedChange={setIsMinimized}
            isWindowMinimized={isWindowMinimized}
            onWindowMinimizedChange={setIsWindowMinimized}
            showBubble={showBubble}
            onBubbleChange={setShowBubble}
            onSendMessage={onSendMessage}
            typingIndicator={typing}
          />
        </div>
      </div>
    </div>
  );
}
