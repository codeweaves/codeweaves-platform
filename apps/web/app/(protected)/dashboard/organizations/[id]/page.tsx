'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AlertCircle, ArrowLeft, Calendar, Trash2, Users } from 'lucide-react';
import { useProfile } from '@/hooks/use-profile';
import { useOrganization } from '@/hooks/use-organizations';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DeleteOrganizationDialog } from '@/components/features/organizations/delete-organization-dialog';

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function OrganizationDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { profile, isLoading: profileLoading } = useProfile();
  const { data: org, isLoading: orgLoading, isError } = useOrganization(params.id);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // SUPER_ADMIN only — both ADMIN and SUPER_ADMIN are platform-level roles
  // (no org of their own), but rename/delete are intentionally narrowed to
  // SUPER_ADMIN to keep the destructive action gated.
  const canDelete = profile?.role === 'SUPER_ADMIN';

  useEffect(() => {
    if (!profileLoading && profile?.role === 'CLIENT') {
      router.replace('/dashboard');
    }
  }, [profileLoading, profile, router]);

  if (profileLoading || profile?.role === 'CLIENT') {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/dashboard/organizations')}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Organizations
        </Button>
      </div>

      {orgLoading ? (
        <DetailSkeleton />
      ) : isError ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <AlertCircle className="h-12 w-12 text-destructive/50" />
          <h2 className="mt-4 text-lg font-semibold">Failed to load organization</h2>
          <p className="text-muted-foreground mt-2">
            Something went wrong. Please try again later.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => router.push('/dashboard/organizations')}
          >
            Back to Organizations
          </Button>
        </div>
      ) : org ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{org.name}</h1>
              <p className="text-muted-foreground font-mono text-sm">{org.slug}</p>
            </div>
            {canDelete && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete organization
              </Button>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Users</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{org._count.users}</div>
                <p className="text-xs text-muted-foreground">Total members</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Created</CardTitle>
                <Calendar className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatDate(org.createdAt)}</div>
                <p className="text-xs text-muted-foreground">Creation date</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Members</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Member management will be available in a future update.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Agents</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Agent management will be available in a future update.
                </p>
              </CardContent>
            </Card>
          </div>
        </>
      ) : (
        <div className="text-center py-12">
          <h2 className="text-lg font-semibold">Organization not found</h2>
          <p className="text-muted-foreground mt-2">
            The organization you&apos;re looking for doesn&apos;t exist.
          </p>
        </div>
      )}

      {org && canDelete && (
        <DeleteOrganizationDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          organizationId={org.id}
          organizationName={org.name}
          onDeleted={() => router.replace('/dashboard/organizations')}
        />
      )}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-5 w-32 mt-2" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-3 w-20 mt-2" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
