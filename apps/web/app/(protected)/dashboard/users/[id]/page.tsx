'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, AlertCircle, Building2, Globe } from 'lucide-react';
import { usePageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { usePermissions } from '@/hooks/use-permissions';
import { useUser } from '@/hooks/use-rbac';
import { EditRolesDialog } from '@/components/features/users/edit-roles-dialog';
import { formatDate } from '@/lib/utils';

export default function UserDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { can, isLoading: permsLoading } = usePermissions();
  const { setTitle } = usePageHeader();
  const [dialogOpen, setDialogOpen] = useState(false);

  const canRead = can('User:Read');
  const canManage = can('Member:Manage');

  const { data: user, isLoading, isError } = useUser(canRead ? params.id : null);

  useEffect(() => {
    setTitle('User');
    return () => setTitle('');
  }, [setTitle]);

  useEffect(() => {
    if (!permsLoading && !canRead) router.replace('/dashboard');
  }, [permsLoading, canRead, router]);

  /**
   * Effective permissions, grouped by resource. This is the answer to "why can
   * this person do that", and the reason permissions are never assigned
   * individually — they are always the consequence of a role.
   */
  const grouped = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const permission of user?.permissions ?? []) {
      const [resource = 'Other', action = permission] = permission.split(':');
      if (!out.has(resource)) out.set(resource, []);
      out.get(resource)!.push(action);
    }
    return [...out.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [user?.permissions]);

  if (permsLoading || !canRead) return null;

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !user) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border p-10 text-center">
        <AlertCircle className="size-6 text-destructive" />
        <span className="text-sm text-muted-foreground">
          This user does not exist, or is outside your organization.
        </span>
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard/users">Back to users</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/dashboard/users">
          <ArrowLeft className="size-4" />
          All users
        </Link>
      </Button>

      {/* Identity */}
      <section className="rounded-lg border p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold">{user.name ?? 'Unnamed'}</h2>
            <p className="mt-1 font-mono text-sm text-muted-foreground">{user.email}</p>
          </div>
          <Badge variant="outline" className="gap-1">
            {user.accessScope === 'PLATFORM' ? (
              <Globe className="size-3" />
            ) : (
              <Building2 className="size-3" />
            )}
            {user.accessScope}
          </Badge>
        </div>

        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              Organization
            </dt>
            <dd className="mt-1 text-sm">{user.organization?.name ?? 'None'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Joined</dt>
            <dd className="mt-1 text-sm tabular-nums">{formatDate(user.createdAt)}</dd>
          </div>
        </dl>
      </section>

      {/* Roles */}
      <section className="rounded-lg border p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">Roles</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              What this person has been granted.
            </p>
          </div>
          {canManage && (
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              Edit roles
            </Button>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {user.roleKeys.length === 0 ? (
            <span className="text-sm text-muted-foreground">No roles assigned.</span>
          ) : (
            user.roleKeys.map((key) => (
              <Badge key={key} variant="secondary" className="font-mono text-xs">
                {key}
              </Badge>
            ))
          )}
        </div>
      </section>

      {/* Effective permissions */}
      <section className="rounded-lg border p-6">
        <h3 className="font-semibold">Effective permissions</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything the roles above add up to. Read-only: permissions come from
          roles, never assigned one by one.
        </p>

        {grouped.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">None.</p>
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {grouped.map(([resource, actions]) => (
              <div key={resource}>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {resource}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {actions.map((action) => (
                    <Badge
                      key={action}
                      variant="outline"
                      className="px-1.5 py-0 font-mono text-[10px]"
                    >
                      {action}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {canManage && (
        <EditRolesDialog user={user} open={dialogOpen} onOpenChange={setDialogOpen} />
      )}
    </div>
  );
}
