'use client';

import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Send, Bot, User } from 'lucide-react';
import Link from 'next/link';
import { apiUrl } from '@/config/api';

interface Starter {
  message: string;
}

interface AgentDemoInfo {
  id: string;
  publicId: string;
  name: string;
  welcomeMessage: string | null;
  theme: {
    starters?: Starter[];
    [key: string]: unknown;
  } | null;
}

interface Message {
  id: string;
  role: 'user' | 'bot';
  content: string;
  timestamp: Date;
}

interface DemoPageClientProps {
  agentId: string;
}

export function DemoPageClient({ agentId }: DemoPageClientProps) {
  const [agent, setAgent] = useState<AgentDemoInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [startersVisible, setStartersVisible] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function fetchAgent() {
      try {
        const res = await fetch(apiUrl(`/public/agents/${agentId}/demo`));
        if (!res.ok) {
          if (res.status === 404) {
            setError('Agent not found or inactive.');
          } else {
            setError('Failed to load agent information.');
          }
          return;
        }
        const data: AgentDemoInfo = await res.json();
        setAgent(data);
      } catch {
        setError('Failed to connect to the server.');
      } finally {
        setLoading(false);
      }
    }
    fetchAgent();
  }, [agentId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const sendMessage = async (content: string) => {
    if (!content.trim() || !agent || isTyping) return;

    setStartersVisible(false);

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');

    // Simulate bot response (webhook integration will be added later)
    setIsTyping(true);
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const botMsg: Message = {
      id: crypto.randomUUID(),
      role: 'bot',
      content:
        'This is a demo response. Webhook integration will be configured by your administrator.',
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, botMsg]);
    setIsTyping(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleStarterClick = (starter: Starter) => {
    void sendMessage(starter.message);
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          <p className="text-sm text-gray-500">Loading agent...</p>
        </div>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <Bot className="mx-auto h-16 w-16 text-gray-300" />
          <h2 className="mt-4 text-xl font-semibold text-gray-700">
            {error ?? 'Agent not available'}
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            This agent may be inactive or does not exist.
          </p>
          <Link
            href="/"
            className="mt-6 inline-block text-sm text-blue-600 hover:underline"
          >
            Go to homepage
          </Link>
        </div>
      </div>
    );
  }

  const starters = agent.theme?.starters ?? [];
  const welcomeMessage =
    agent.welcomeMessage ?? `Hi! I'm ${agent.name}. How can I help you today?`;

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* Header */}
      <header className="flex items-center gap-3 border-b bg-white px-4 py-3 shadow-sm">
        <Link
          href="/dashboard/agents"
          className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
          {agent.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1">
          <h1 className="text-sm font-semibold text-gray-900">{agent.name}</h1>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            <span className="text-xs text-gray-500">Online</span>
          </div>
        </div>
      </header>

      {/* Chat Area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-4 py-6">
            {/* Welcome Message */}
            <div className="mb-6 flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                {agent.name.charAt(0).toUpperCase()}
              </div>
              <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-white px-4 py-3 text-sm text-gray-800 shadow-sm">
                {welcomeMessage}
              </div>
            </div>

            {/* Conversation Starters */}
            {startersVisible && starters.length > 0 && (
              <div className="mb-6 flex flex-wrap gap-2 pl-11">
                {starters.map((starter, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleStarterClick(starter)}
                    className="rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700 transition-colors hover:bg-blue-100"
                  >
                    {starter.message}
                  </button>
                ))}
              </div>
            )}

            {/* Messages */}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`mb-4 flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
              >
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
                    msg.role === 'user' ? 'bg-gray-500' : 'bg-blue-600'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <User className="h-4 w-4" />
                  ) : (
                    agent.name.charAt(0).toUpperCase()
                  )}
                </div>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
                    msg.role === 'user'
                      ? 'rounded-tr-sm bg-blue-600 text-white'
                      : 'rounded-tl-sm bg-white text-gray-800'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}

            {/* Typing Indicator */}
            {isTyping && (
              <div className="mb-4 flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                  {agent.name.charAt(0).toUpperCase()}
                </div>
                <div className="rounded-2xl rounded-tl-sm bg-white px-4 py-3 shadow-sm">
                  <div className="flex gap-1">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="border-t bg-white px-4 py-3">
            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                disabled={isTyping}
              />
              <button
                type="submit"
                disabled={!input.trim() || isTyping}
                className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
            <p className="mt-2 text-center text-xs text-gray-400">
              Powered by CodeWeaves
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
