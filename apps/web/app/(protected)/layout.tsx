import { AuthGuard } from '@/components/features/auth/auth-guard';
import { DashboardShell } from '@/components/layout/dashboard-shell';

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <DashboardShell>{children}</DashboardShell>
    </AuthGuard>
  );
}
