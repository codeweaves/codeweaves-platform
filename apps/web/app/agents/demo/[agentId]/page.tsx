import type { Metadata } from 'next';
import { DemoPageClient } from './demo-page-client';

interface Props {
  params: Promise<{ agentId: string }>;
}

export const metadata: Metadata = {
  title: 'Agent Demo - Klivo',
  description: 'Try out this AI chat agent',
};

export default async function DemoPage({ params }: Props) {
  const { agentId } = await params;
  return <DemoPageClient agentId={agentId} />;
}
