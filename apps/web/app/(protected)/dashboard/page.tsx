'use client';

import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { Bot, Palette, BarChart3, Users, Settings } from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';

const quickLinks = [
  {
    title: 'Agents',
    description: 'Manage your AI chat agents',
    href: '/dashboard/agents',
    icon: Bot,
  },
  {
    title: 'Theme Editor',
    description: 'Customize your widget appearance',
    href: '/dashboard/theme',
    icon: Palette,
  },
  {
    title: 'Analytics',
    description: 'View performance metrics',
    href: '/dashboard/analytics',
    icon: BarChart3,
  },
  {
    title: 'Team',
    description: 'Manage team members',
    href: '/dashboard/team',
    icon: Users,
  },
  {
    title: 'Settings',
    description: 'Configure your account',
    href: '/dashboard/settings',
    icon: Settings,
  },
];

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <div>
      <h1 className="text-2xl font-bold">
        Welcome, {user?.name || 'User'}!
      </h1>
      <p className="mt-2 text-muted-foreground">
        This is your CodeWeaves dashboard. Manage your AI chat agents, customize
        themes, and view analytics.
      </p>

      <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {quickLinks.map((link) => (
          <Link key={link.href} href={link.href} className="block">
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <link.icon className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-lg">{link.title}</CardTitle>
                </div>
                <CardDescription>{link.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
