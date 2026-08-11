'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useProfile } from '@/hooks/use-profile';
import { usePageHeader } from '@/components/layout/page-header';
import { useApiClient } from '@/lib/api-client';
import { accountRoleLabel } from '@/lib/role-label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function SettingsPage() {
  const { profile, isLoading } = useProfile();
  const { setTitle } = usePageHeader();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [name, setName] = useState('');
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setTitle('Settings');
    return () => setTitle('');
  }, [setTitle]);

  useEffect(() => {
    if (profile?.name) {
      setName(profile.name);
    }
  }, [profile?.name]);

  useEffect(() => {
    setHasChanges(name.trim() !== (profile?.name ?? ''));
  }, [name, profile?.name]);

  const updateProfile = useMutation({
    mutationFn: (data: { name: string }) => api.patch('auth/users/me', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      toast.success('Profile updated');
    },
    onError: () => {
      toast.error('Failed to update profile');
    },
  });

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    updateProfile.mutate({ name: trimmed });
  };

  if (isLoading) {
    return null;
  }

  const roleLabel = accountRoleLabel(profile) ?? '';

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Profile Information</CardTitle>
          <CardDescription>Update your personal details.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              value={profile?.email ?? ''}
              disabled
              className="text-muted-foreground"
            />
            <p className="text-xs text-muted-foreground">Email is managed by your authentication provider.</p>
          </div>

          <div className="space-y-2">
            <Label>Roles</Label>
            <Input
              value={roleLabel}
              disabled
              className="text-muted-foreground"
            />
            <p className="text-xs text-muted-foreground">
              Roles are additive and only a platform administrator can change them.
            </p>
          </div>

          {profile?.organization && (
            <div className="space-y-2">
              <Label>Organization</Label>
              <Input
                value={profile.organization.name}
                disabled
                className="text-muted-foreground"
              />
            </div>
          )}

          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              disabled={!hasChanges || updateProfile.isPending}
            >
              {updateProfile.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Security</CardTitle>
          <CardDescription>Manage your password and account security.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Password</p>
              <p className="text-sm text-muted-foreground">
                We&apos;ll email you a code to set a new password.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => router.push('/reset-password')}
            >
              Reset Password
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
