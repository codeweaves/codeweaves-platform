import { ConversationUsageClient } from "@/components/features/admin-usage/conversation-usage-client";

export default async function ConversationUsagePage({
  params,
}: {
  params: Promise<{ chatSessionId: string }>;
}) {
  const { chatSessionId } = await params;
  return <ConversationUsageClient chatSessionId={chatSessionId} />;
}
