"use client";

import { EventLogsTable } from "@/components/features/ops-console/event-logs-table";
import { useOpsPageGate } from "@/components/features/ops-console/ops-shared";

export default function EventLogsPage() {
  const allowed = useOpsPageGate("Event log");
  if (!allowed) return null;
  return <EventLogsTable />;
}
