'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  const [showBubble, setShowBubble] = useState(true);
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Scale the preview down if the container is too short for the widget + launcher + offset.
  // Widget uses clamp(520px, 58vh, 800px), so `needed` depends on the current viewport.
  const updateScale = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const available = el.clientHeight;
    const widgetHeight = Math.max(520, Math.min(800, window.innerHeight * 0.58));
    const needed = widgetHeight + 80; // 60 launcher + 20 offset
    setScale(available < needed ? Math.max(0.7, available / needed) : 1);
  }, []);

  useEffect(() => {
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [updateScale]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-gray-100 p-4">
        <h3 className="text-lg font-semibold text-gray-900">Live Preview</h3>
      </div>

      {/* Preview container — scales widget to fit */}
      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-gradient-to-br from-gray-50 to-gray-100"
      >
        <div
          className="relative h-full w-full"
          style={{
            transform: scale < 1 ? `scale(${scale})` : undefined,
            transformOrigin: 'bottom right',
          }}
        >
          <ChatWidgetSurface
            formData={formData}
            messages={chatMessages}
            isMinimized={isMinimized}
            onMinimizedChange={setIsMinimized}
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
