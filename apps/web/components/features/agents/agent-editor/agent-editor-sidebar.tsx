'use client';

import {
  FileText,
  Palette,
  MessageCircle,
  Settings,
  Mic,
  ScrollText,
  Plug,
  BadgeInfo,
  Sparkles,
  MessageSquareText,
  ClipboardList,
  Headset,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';

export type CategoryId =
  | 'general'
  | 'appearance'
  | 'chat'
  | 'behavior'
  | 'voice'
  | 'prompt'
  | 'classification'
  | 'dataCapture'
  | 'integration'
  | 'whatsapp'
  | 'branding'
  | 'humanHandover';

interface Category {
  id: CategoryId;
  title: string;
  icon: React.ReactNode;
  description: string;
  /**
   * Permission that unlocks this section. Every section has one: the editor is
   * a bundle of separately grantable slices, so a teammate can be given the
   * prompt without also getting the WhatsApp credentials.
   */
  requires: string;
}

const allCategories: Category[] = [
  {
    id: 'general',
    title: 'General',
    icon: <FileText className="h-5 w-5" />,
    description: 'Name and client mapping',
    requires: 'Agent:Update',
  },
  {
    id: 'appearance',
    title: 'Appearance',
    icon: <Palette className="h-5 w-5" />,
    description: 'Colors, icons, and visual styling',
    requires: 'AgentTheme:Update',
  },
  {
    id: 'chat',
    title: 'Chat Interface',
    icon: <MessageCircle className="h-5 w-5" />,
    description: 'Messages, avatars, and chat layout',
    requires: 'AgentTheme:Update',
  },
  {
    id: 'behavior',
    title: 'Behavior',
    icon: <Settings className="h-5 w-5" />,
    description: 'Interactions and user experience',
    requires: 'Agent:Update',
  },
  {
    id: 'voice',
    title: 'Voice',
    icon: <Mic className="h-5 w-5" />,
    description: 'Voice input and output settings',
    requires: 'Agent:Update',
  },
  {
    id: 'prompt',
    title: 'Prompt',
    icon: <ScrollText className="h-5 w-5" />,
    description: 'Initial context and knowledge base',
    requires: 'Agent:UpdatePrompt',
  },
  {
    id: 'classification',
    title: 'Classification',
    icon: <Sparkles className="h-5 w-5" />,
    description: 'AI tagging: conversation topics & language detection',
    requires: 'Agent:Update',
  },
  {
    id: 'dataCapture',
    title: 'Data Capture',
    icon: <ClipboardList className="h-5 w-5" />,
    description: 'Collect fields (name, email, …) from conversations',
    requires: 'AgentDataField:Read',
  },
  {
    id: 'integration',
    title: 'Integration',
    icon: <Plug className="h-5 w-5" />,
    description: 'Routing: n8n webhook or native AI orchestrator',
    requires: 'AgentSecret:Read',
  },
  {
    id: 'whatsapp',
    title: 'WhatsApp',
    icon: <MessageSquareText className="h-5 w-5" />,
    description: 'Connect a WhatsApp number to this agent',
    requires: 'WhatsappChannel:Read',
  },
  {
    id: 'branding',
    title: 'Branding',
    icon: <BadgeInfo className="h-5 w-5" />,
    description: 'Powered by / logo footer',
    requires: 'AgentTheme:UpdateBranding',
  },
  {
    id: 'humanHandover',
    title: 'Human Handover',
    icon: <Headset className="h-5 w-5" />,
    description: 'Let a teammate take over live chats',
    requires: 'Agent:UpdateHandover',
  },
];

interface AgentEditorSidebarProps {
  selectedCategory: CategoryId;
  onCategoryChange: (category: CategoryId) => void;
}

export function AgentEditorSidebar({
  selectedCategory,
  onCategoryChange,
}: AgentEditorSidebarProps) {
  const { can } = usePermissions();

  const categories = allCategories.filter((cat) => can(cat.requires));

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r bg-background">
      <div className="shrink-0 px-6 py-4">
        <h2 className="text-lg font-semibold">Configuration</h2>
      </div>

      {/* Scrolls independently when the section list outgrows the viewport. */}
      <nav className="thin-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <div className="space-y-1">
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => onCategoryChange(category.id)}
              className={cn(
                'flex w-full cursor-pointer items-center gap-3 rounded-lg p-3 text-left transition-colors',
                selectedCategory === category.id
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-foreground hover:bg-muted',
              )}
            >
              <div
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                  selectedCategory === category.id
                    ? 'bg-white/15 text-primary-foreground'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {category.icon}
              </div>
              <span className="text-sm font-medium">{category.title}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
