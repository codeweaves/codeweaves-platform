'use client';

import { AlertCircle, Users } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { useTeamMembers, type TeamMember } from '@/hooks/use-team';
import type { Role } from '@/hooks/use-profile';
import { formatDate } from '@/lib/utils';

function getInitials(name: string | null, email: string): string {
  if (name) {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }
  return email[0]?.toUpperCase() ?? '?';
}

const roleBadgeConfig: Record<Role, { label: string; className: string }> = {
  SUPER_ADMIN: {
    label: 'Super Admin',
    className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  },
  ADMIN: {
    label: 'Admin',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  },
  CLIENT: {
    label: 'Client',
    className: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400',
  },
};

function RoleBadge({ role }: { role: Role }) {
  const config = roleBadgeConfig[role];
  return (
    <Badge variant="outline" className={config.className}>
      {config.label}
    </Badge>
  );
}

function MemberRow({ member }: { member: TeamMember }) {
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs font-semibold">
              {getInitials(member.name, member.email)}
            </AvatarFallback>
          </Avatar>
          <span className="font-medium">{member.name || member.email}</span>
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">{member.email}</TableCell>
      <TableCell>
        <RoleBadge role={member.role} />
      </TableCell>
      <TableCell className="text-muted-foreground">
        {formatDate(member.createdAt)}
      </TableCell>
    </TableRow>
  );
}

function TableSkeleton() {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Joined</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 3 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <Skeleton className="h-5 w-32" />
                </div>
              </TableCell>
              <TableCell><Skeleton className="h-5 w-40" /></TableCell>
              <TableCell><Skeleton className="h-5 w-16" /></TableCell>
              <TableCell><Skeleton className="h-5 w-24" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function TeamMembersList() {
  const { data: members, isLoading, isError } = useTeamMembers();

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Team Members</h2>

      {isLoading ? (
        <TableSkeleton />
      ) : isError ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <AlertCircle className="h-12 w-12 text-destructive/50" />
          <h3 className="mt-4 text-lg font-semibold">Failed to load team members</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Something went wrong. Please try refreshing the page.
          </p>
        </div>
      ) : !members?.length ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <Users className="h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-semibold">No team members yet</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Invite your first team member to get started.
          </p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...members]
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .map((member) => (
                  <MemberRow key={member.id} member={member} />
                ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export { RoleBadge };
