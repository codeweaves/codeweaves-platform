"use client";

import { SystemStatusView } from "@/components/features/ops-console/system-status-view";
import { useOpsPageGate } from "@/components/features/ops-console/ops-shared";

export default function SystemStatusPage() {
  const allowed = useOpsPageGate("System status");
  if (!allowed) return null;
  return <SystemStatusView />;
}
