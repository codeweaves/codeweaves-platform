'use client';

import type { ReactNode } from 'react';
import { useCurrentRole } from '@/hooks/use-current-role';
import type { Role } from '@/hooks/use-current-role';

interface RoleGateProps {
  roles: Role[];
  children: ReactNode;
  fallback?: ReactNode;
}

export function RoleGate({ roles, children, fallback = null }: RoleGateProps) {
  const { role, isLoading } = useCurrentRole();

  if (isLoading) return null;
  if (!role || !roles.includes(role)) return <>{fallback}</>;

  return <>{children}</>;
}
