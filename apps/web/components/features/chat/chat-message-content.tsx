import { memo } from 'react';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';

interface ChatMessageContentProps {
  content: string;
  isStreaming?: boolean;
}

const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 underline decoration-blue-300 hover:decoration-blue-600"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="my-1.5 ml-4 list-disc space-y-0.5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1.5 ml-4 list-decimal space-y-0.5">{children}</ol>
  ),
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  code: ({ children }) => (
    <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs text-gray-800">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-1.5 overflow-x-auto rounded-md bg-gray-900 px-3 py-2 font-mono text-xs text-gray-100">
      {children}
    </pre>
  ),
  p: ({ children }) => <p className="my-1 first:mt-0 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
};

function ChatMessageContentInner({ content }: ChatMessageContentProps) {
  if (!content) return <span>{'\u00A0'}</span>;

  return (
    <div className="max-w-none">
      <Markdown components={markdownComponents}>{content}</Markdown>
    </div>
  );
}

export const ChatMessageContent = memo(ChatMessageContentInner);
