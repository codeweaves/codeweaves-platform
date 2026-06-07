import { Role, InvitationStatus } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import type { TenantFilterUser } from '../../src/utils/tenant-filter';

// ── Mock Organization Factories ──────────────────────────────────────

export interface MockOrganization {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

export function createTestOrg(
  name: string,
  overrides: Partial<MockOrganization> = {},
): MockOrganization {
  const slug = name.toLowerCase().replace(/\s+/g, '-');
  return {
    id: `org-${slug}-uuid`,
    name,
    slug,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

// ── Mock User Factories ──────────────────────────────────────────────

export interface MockUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  clerkId: string;
  organizationId: string | null;
  organization: MockOrganization | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function createTestUser(
  org: MockOrganization | null,
  role: Role,
  suffix: string = '',
): MockUser {
  const orgSlug = org?.slug ?? 'platform';
  const roleName = role.toLowerCase();
  const id = `user-${orgSlug}-${roleName}${suffix}-uuid`;
  return {
    id,
    email: `${roleName}${suffix}@${orgSlug}.test`,
    name: `${role} User${suffix} (${org?.name ?? 'Platform'})`,
    role,
    clerkId: `user_${orgSlug}-${roleName}${suffix}`,
    organizationId: org?.id ?? null,
    organization: org,
    deletedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };
}

export function createTenantFilterUser(
  user: MockUser,
): TenantFilterUser {
  return {
    role: user.role,
    organizationId: user.organizationId,
  };
}

// ── Mock Invitation Factory ──────────────────────────────────────────

export interface MockInvitation {
  id: string;
  email: string;
  role: Role;
  organizationId: string;
  token: string;
  reissueToken: string;
  reissueCount: number;
  status: InvitationStatus;
  expiresAt: Date;
  createdAt: Date;
  invitedBy: string | null;
  clerkInvitationId: string | null;
}

export function createTestInvitation(
  org: MockOrganization,
  overrides: Partial<MockInvitation> = {},
): MockInvitation {
  const idx = Math.random().toString(36).slice(2, 8);
  return {
    id: `inv-${org.slug}-${idx}`,
    email: `invitee-${idx}@${org.slug}.test`,
    role: Role.CLIENT,
    organizationId: org.id,
    token: `token-${org.slug}-${idx}`,
    reissueToken: `reissue-${org.slug}-${idx}`,
    reissueCount: 0,
    status: InvitationStatus.PENDING,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    invitedBy: null,
    clerkInvitationId: null,
    ...overrides,
  };
}

// ── Seed Helpers ─────────────────────────────────────────────────────

export interface TestOrgData {
  org: MockOrganization;
  client: MockUser;
  admin: MockUser;
  users: MockUser[];
  invitations: MockInvitation[];
}

/**
 * Create a complete set of test data for an organization:
 * - The organization itself
 * - A CLIENT user
 * - An ADMIN user
 * - 2 pending invitations
 */
export function seedTestData(name: string): TestOrgData {
  const org = createTestOrg(name);
  const client = createTestUser(org, Role.CLIENT);
  const admin = createTestUser(org, Role.ADMIN);
  const users = [client, admin];

  const invitations = [
    createTestInvitation(org, {
      id: `inv-${org.slug}-1`,
      email: `invite1@${org.slug}.test`,
      token: `token-${org.slug}-1`,
      reissueToken: `reissue-${org.slug}-1`,
      invitedBy: admin.id,
    }),
    createTestInvitation(org, {
      id: `inv-${org.slug}-2`,
      email: `invite2@${org.slug}.test`,
      token: `token-${org.slug}-2`,
      reissueToken: `reissue-${org.slug}-2`,
      invitedBy: admin.id,
    }),
  ];

  return { org, client, admin, users, invitations };
}

// ── Assertion Helpers ────────────────────────────────────────────────

/**
 * Assert that calling `fn` throws a NotFoundException.
 * Per AC#3: cross-tenant access should return 404 (not 403)
 * to prevent information leakage.
 */
export async function expectTenantIsolated(
  fn: () => Promise<unknown>,
): Promise<void> {
  await expect(fn()).rejects.toThrow(NotFoundException);
}

/**
 * Assert that a service method called with a cross-tenant user
 * throws NotFoundException.
 */
export async function expectCrossTenantBlocked(
  serviceFn: () => Promise<unknown>,
): Promise<void> {
  await expect(serviceFn()).rejects.toThrow(NotFoundException);
}
