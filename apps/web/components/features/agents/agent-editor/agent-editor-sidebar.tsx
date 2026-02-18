'use client';

import {
  FileText,
  Palette,
  MessageCircle,
  Settings,
  ScrollText,
  Plug,
  BadgeInfo,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProfile } from '@/hooks/use-profile';

export type CategoryId =
  | 'general'
  | 'appearance'
  | 'chat'
  | 'behavior'
  | 'prompt'
  | 'integration'
  | 'branding';

interface Category {
  id: CategoryId;
  title: string;
  icon: React.ReactNode;
  description: string;
  adminOnly?: boolean;
}

const allCategories: Category[] = [
  {
    id: 'general',
    title: 'General',
    icon: <FileText className="h-5 w-5" />,
    description: 'Name and client mapping',
  },
  {
    id: 'appearance',
    title: 'Appearance',
    icon: <Palette className="h-5 w-5" />,
    description: 'Colors, icons, and visual styling',
  },
  {
    id: 'chat',
    title: 'Chat Interface',
    icon: <MessageCircle className="h-5 w-5" />,
    description: 'Messages, avatars, and chat layout',
  },
  {
    id: 'behavior',
    title: 'Behavior',
    icon: <Settings className="h-5 w-5" />,
    description: 'Interactions and user experience',
  },
  {
    id: 'prompt',
    title: 'Prompt',
    icon: <ScrollText className="h-5 w-5" />,
    description: 'Initial context and organization info',
    adminOnly: true,
  },
  {
    id: 'integration',
    title: 'Integration',
    icon: <Plug className="h-5 w-5" />,
    description: 'Webhooks and external connections',
    adminOnly: true,
  },
  {
    id: 'branding',
    title: 'Branding',
    icon: <BadgeInfo className="h-5 w-5" />,
    description: 'Powered by / logo footer',
    adminOnly: true,
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
  const { profile } = useProfile();
  const isAdmin =
    profile?.role === 'SUPER_ADMIN' || profile?.role === 'ADMIN';

  const categories = allCategories.filter(
    (cat) => !cat.adminOnly || isAdmin,
  );

  return (
    <div className="w-64 shrink-0 border-r bg-background">
      <div className="px-6 py-4">
        <h2 className="text-lg font-semibold">Configuration</h2>
      </div>

      <nav className="px-3 pb-4">
        <div className="space-y-1">
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => onCategoryChange(category.id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors',
                selectedCategory === category.id
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <div
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                  selectedCategory === category.id
                    ? 'bg-primary/20 text-primary'
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
