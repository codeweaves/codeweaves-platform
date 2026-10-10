"use client";

import { AuditLogsTable } from "@/components/features/ops-console/audit-logs-table";
import { useOpsPageGate } from "@/components/features/ops-console/ops-shared";

export default function AuditLogsPage() {
  const allowed = useOpsPageGate("Audit log");
  if (!allowed) return null;
  return <AuditLogsTable />;
}
