/**
 * Evil Twin Tenant Isolation Tests (Story 2.5)
 *
 * Verifies that no cross-tenant data leakage exists by creating
 * two test organizations (Org A "Acme Corp", Org B "Evil Corp")
 * and asserting that users from one org can never access the other's resources.
 *
 * P0 — CRITICAL: Tenant isolation failures are security vulnerabilities.
 *
 * Architecture: ADR-006 (application-level isolation)
 * NFR: NFR20-23 (security test coverage)
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ConfigService } from '@nestjs/config';

import { UsersService } from '../../src/services/users.service';
import { PermissionCatalogService } from '../../src/common/rbac/permission-catalog.service';
import { OrganizationsService } from '../../src/services/organizations.service';
import { InvitationsService } from '../../src/services/invitations.service';
import { PrismaService } from '../../src/services/prisma.service';
import { EmailService } from '../../src/services/email.service';
import { EmailTemplateService } from '../../src/services/email-template.service';
import { ClerkManagementService } from '../../src/services/clerk-management.service';
import { OrganizationLoggerService } from '../../src/common/logger/organization.logger';
import { InvitationLoggerService } from '../../src/common/logger/invitation.logger';
import { UserLoggerService } from '../../src/common/logger/user.logger';

import {
  seedTestData,
  createTestUser,
  createTenantFilterUser,
  expectTenantIsolated,
  type TestOrgData,
  type MockUser,
} from '../helpers/tenant-test.helper';

// ── Evil Twin Setup ──────────────────────────────────────────────────

describe('Tenant Isolation — Evil Twin', () => {
  // Two organizations
  let orgAData: TestOrgData;
  let orgBData: TestOrgData;

  // Super Admin (cross-org access)
  let superAdmin: MockUser;

  // Services under test
  let usersService: UsersService;
  let organizationsService: OrganizationsService;
  let invitationsService: InvitationsService;

  // Mocks
  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    organization: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    userInvitation: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockEmailService = { send: jest.fn() };
  // Invite bodies come from the DB-backed TEAM_INVITATION template.
  const mockEmailTemplates = { render: jest.fn() };
  const mockConfigService = {
    get: (key: string, defaultValue?: string) => {
      const config: Record<string, string> = {
        DASHBOARD_URL: 'http://localhost:3000',
      };
      return config[key] ?? defaultValue;
    },
  };
  const mockClerkManagement = {
    createInvitation: jest.fn(),
    revokeInvitation: jest.fn(),
  };

  beforeAll(() => {
    // Seed Evil Twin data
    orgAData = seedTestData('Acme Corp');
    orgBData = seedTestData('Evil Corp');
    superAdmin = createTestUser(null, Role.SUPER_ADMIN);
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          // Shared by UsersService (profile permissions) and InvitationsService
          // (validating the roles an invite carries).
          provide: PermissionCatalogService,
          useValue: {
            resolvePermissions: () => new Set<string>(),
            getRole: (key: string) =>
              key.startsWith('org.')
                ? { key, orgAllowed: true, clientGrantable: key !== 'org.owner' }
                : { key, orgAllowed: false, clientGrantable: false },
          },
        },
        OrganizationsService,
        InvitationsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailService, useValue: mockEmailService },
        { provide: EmailTemplateService, useValue: mockEmailTemplates },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: ClerkManagementService, useValue: mockClerkManagement },
        { provide: OrganizationLoggerService, useValue: { logOrganizationCreated: jest.fn(), logOrganizationCreationException: jest.fn(), logOrganizationUpdated: jest.fn(), logOrganizationUpdateException: jest.fn(), logOrganizationCreationFailed: jest.fn() } },
        { provide: InvitationLoggerService, useValue: { logInvitationCreated: jest.fn(), logInvitationCreationException: jest.fn(), logInvitationResent: jest.fn(), logInvitationCancelled: jest.fn(), logInvitationReissued: jest.fn(), logInvitationResentException: jest.fn(), logInvitationCancelledException: jest.fn(), logInvitationReissuedException: jest.fn(), logInvitationCreationFailed: jest.fn() } },
        { provide: UserLoggerService, useValue: { logUserCreatedFromAuth0: jest.fn(), logUserCreatedFromInvitation: jest.fn(), logUserCreationException: jest.fn(), logUserProfileUpdated: jest.fn(), logUserFirstLogin: jest.fn(), logMemberAssigned: jest.fn(), logMemberRemoved: jest.fn(), logUserProfileUpdateException: jest.fn() } },
      ],
    }).compile();

    usersService = module.get<UsersService>(UsersService);
    organizationsService =
      module.get<OrganizationsService>(OrganizationsService);
    invitationsService =
      module.get<InvitationsService>(InvitationsService);

    jest.clearAllMocks();
    mockEmailService.send.mockResolvedValue({ id: 'email-id' });
    mockEmailTemplates.render.mockResolvedValue({
      subject: 'You have been invited to Klivo',
      html: '<p>invite</p>',
      text: 'invite',
    });
    mockClerkManagement.createInvitation.mockResolvedValue({
      id: 'clerk_inv_new',
      url: 'https://accounts.klivo.app/accept?__clerk_ticket=abc123',
    });
    mockClerkManagement.revokeInvitation.mockResolvedValue(undefined);
  });

  // ────────────────────────────────────────────────────────────────────
  // AC#1: Two test organizations created (Acme Corp, Evil Corp)
  // ────────────────────────────────────────────────────────────────────

  describe('AC#1: Evil Twin setup', () => {
    it('should create two distinct organizations', () => {
      expect(orgAData.org.name).toBe('Acme Corp');
      expect(orgBData.org.name).toBe('Evil Corp');
      expect(orgAData.org.id).not.toBe(orgBData.org.id);
    });

    it('should create users for each organization', () => {
      expect(orgAData.client.organizationId).toBe(orgAData.org.id);
      expect(orgBData.client.organizationId).toBe(orgBData.org.id);
      expect(orgAData.client.organizationId).not.toBe(
        orgBData.client.organizationId,
      );
    });

    it('should create a Super Admin without org association', () => {
      expect(superAdmin.role).toBe(Role.SUPER_ADMIN);
      expect(superAdmin.organizationId).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // AC#2 & AC#3: User resource isolation
  // ────────────────────────────────────────────────────────────────────

  describe('User isolation (findAllForTenant)', () => {
    it('AC#2: Org A CLIENT only sees Org A users', async () => {
      mockPrisma.user.findMany.mockResolvedValue(orgAData.users);

      const tenantUser = createTenantFilterUser(orgAData.client);
      const result = await usersService.findAllForTenant(tenantUser);

      expect(result).toEqual(orgAData.users);
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: { organizationId: orgAData.org.id, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('AC#2: Org B CLIENT only sees Org B users', async () => {
      mockPrisma.user.findMany.mockResolvedValue(orgBData.users);

      const tenantUser = createTenantFilterUser(orgBData.client);
      const result = await usersService.findAllForTenant(tenantUser);

      expect(result).toEqual(orgBData.users);
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: { organizationId: orgBData.org.id, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('AC#2: Org A CLIENT filter does NOT include Org B organizationId', async () => {
      mockPrisma.user.findMany.mockResolvedValue(orgAData.users);

      const tenantUser = createTenantFilterUser(orgAData.client);
      await usersService.findAllForTenant(tenantUser);

      const calledWith = mockPrisma.user.findMany.mock.calls[0][0];
      expect(calledWith.where.organizationId).toBe(orgAData.org.id);
      expect(calledWith.where.organizationId).not.toBe(orgBData.org.id);
    });

    it('AC#3: CLIENT without organizationId is rejected', async () => {
      const noOrgUser = createTenantFilterUser({
        ...orgAData.client,
        organizationId: null,
      });

      await expect(
        usersService.findAllForTenant(noOrgUser),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('User isolation (findByOrganization)', () => {
    it('findByOrganization returns only the requested org users', async () => {
      mockPrisma.user.findMany.mockResolvedValue(orgAData.users);

      const result = await usersService.findByOrganization(orgAData.org.id);

      expect(result).toEqual(orgAData.users);
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: { organizationId: orgAData.org.id, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('Org A admin querying findByOrganization for Org A does not include Org B data', async () => {
      mockPrisma.user.findMany.mockResolvedValue(orgAData.users);

      await usersService.findByOrganization(orgAData.org.id);

      const calledWith = mockPrisma.user.findMany.mock.calls[0][0];
      expect(calledWith.where.organizationId).toBe(orgAData.org.id);
      expect(calledWith.where.organizationId).not.toBe(orgBData.org.id);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // AC#5: Super Admin cross-org visibility
  // ────────────────────────────────────────────────────────────────────

  describe('Super Admin cross-org access (Users)', () => {
    it('AC#5: Super Admin sees users from both Org A and Org B', async () => {
      const allUsers = [...orgAData.users, ...orgBData.users];
      mockPrisma.user.findMany.mockResolvedValue(allUsers);

      const tenantUser = createTenantFilterUser(superAdmin);
      const result = await usersService.findAllForTenant(tenantUser);

      expect(result).toEqual(allUsers);
      // No organizationId filter for SUPER_ADMIN
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('AC#5: ADMIN sees users from all orgs (no tenant filter)', async () => {
      const allUsers = [...orgAData.users, ...orgBData.users];
      mockPrisma.user.findMany.mockResolvedValue(allUsers);

      const tenantUser = createTenantFilterUser(orgAData.admin);
      const result = await usersService.findAllForTenant(tenantUser);

      expect(result).toEqual(allUsers);
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // AC#3: Organization resource isolation
  // Organization endpoints are SUPER_ADMIN-only (controller-level guard),
  // so isolation is enforced at the authorization layer, not at the
  // service/filter layer. We verify the service behavior here.
  // ────────────────────────────────────────────────────────────────────

  describe('Organization isolation', () => {
    it('findById returns the requested organization', async () => {
      mockPrisma.organization.findFirst.mockResolvedValue({
        ...orgAData.org,
        _count: { users: orgAData.users.length },
      });

      const result = await organizationsService.findById(orgAData.org.id);

      expect(result.id).toBe(orgAData.org.id);
      expect(result.name).toBe('Acme Corp');
    });

    it('AC#3: findById throws NotFoundException for non-existent org', async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(null);

      await expectTenantIsolated(() =>
        organizationsService.findById('non-existent-uuid'),
      );
    });

    it('findAll returns all organizations (SUPER_ADMIN only endpoint)', async () => {
      const allOrgs = [
        { ...orgAData.org, _count: { users: 2 } },
        { ...orgBData.org, _count: { users: 2 } },
      ];
      mockPrisma.organization.findMany.mockResolvedValue(allOrgs);
      mockPrisma.organization.count.mockResolvedValue(2);

      const result = await organizationsService.findAll();

      expect(result.data).toHaveLength(2);
      expect(result.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Acme Corp' }),
          expect.objectContaining({ name: 'Evil Corp' }),
        ]),
      );
      expect(result.meta.total).toBe(2);
    });

    it('update throws NotFoundException when Org A user tries to update non-existent org', async () => {
      const { PrismaClientKnownRequestError } = jest.requireActual(
        '@prisma/client',
      ) as { PrismaClientKnownRequestError: new (message: string, args: { code: string; clientVersion: string }) => Error };
      mockPrisma.organization.findFirst.mockResolvedValue(null);
      mockPrisma.organization.update.mockRejectedValue(
        new PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: '7.3.0',
        }),
      );

      await expectTenantIsolated(() =>
        organizationsService.update('non-existent-uuid', { name: 'Hacked' }),
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // AC#4: Invitation resource isolation
  // Invitations are currently SUPER_ADMIN/ADMIN only at the controller
  // level. The service does NOT apply tenant filtering on findAll().
  // These tests verify the current behavior and document the boundary.
  // ────────────────────────────────────────────────────────────────────

  describe('Invitation isolation', () => {
    it('findAll returns all invitations (no tenant filter at service level)', async () => {
      const allInvitations = [
        ...orgAData.invitations,
        ...orgBData.invitations,
      ];
      mockPrisma.userInvitation.findMany.mockResolvedValue(allInvitations);
      mockPrisma.userInvitation.count.mockResolvedValue(allInvitations.length);

      const result = await invitationsService.findAll();

      expect(result.data).toHaveLength(4);
      expect(result.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            organizationId: orgAData.org.id,
          }),
          expect.objectContaining({
            organizationId: orgBData.org.id,
          }),
        ]),
      );
    });

    it('AC#3: findById throws NotFoundException for non-existent invitation', async () => {
      mockPrisma.userInvitation.findUnique.mockResolvedValue(null);

      await expectTenantIsolated(() =>
        invitationsService.findById('non-existent-uuid'),
      );
    });

    it('AC#3: cancel throws NotFoundException for non-existent invitation', async () => {
      mockPrisma.userInvitation.findUnique.mockResolvedValue(null);

      await expectTenantIsolated(() =>
        invitationsService.cancel('non-existent-uuid'),
      );
    });

    it('Invitation create enforces the provided organizationId', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.userInvitation.findFirst.mockResolvedValue(null);
      mockPrisma.userInvitation.create.mockResolvedValue({
        ...orgAData.invitations[0],
        email: 'newuser@acme.test',
      });
      mockPrisma.userInvitation.update.mockResolvedValue({
        ...orgAData.invitations[0],
        auth0UserId: 'user_new-user',
      });

      await invitationsService.create(
        {
          email: 'newuser@acme.test',
          roleKeys: ['org.owner'],
          organizationId: orgAData.org.id,
        },
        orgAData.admin.id,
      );

      expect(mockPrisma.userInvitation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: orgAData.org.id,
          email: 'newuser@acme.test',
        }),
      });

      // Verify the created invitation is NOT for Evil Corp
      const createCall = mockPrisma.userInvitation.create.mock.calls[0][0];
      expect(createCall.data.organizationId).not.toBe(orgBData.org.id);
    });

    it('Org B invitation data is not mixed with Org A invitation creation', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.userInvitation.findFirst.mockResolvedValue(null);
      mockPrisma.userInvitation.create.mockResolvedValue({
        ...orgBData.invitations[0],
        email: 'newuser@evil.test',
      });
      mockPrisma.userInvitation.update.mockResolvedValue({
        ...orgBData.invitations[0],
        auth0UserId: 'user_new-user',
      });

      await invitationsService.create(
        {
          email: 'newuser@evil.test',
          roleKeys: ['org.owner'],
          organizationId: orgBData.org.id,
        },
        orgBData.admin.id,
      );

      const createCall = mockPrisma.userInvitation.create.mock.calls[0][0];
      expect(createCall.data.organizationId).toBe(orgBData.org.id);
      expect(createCall.data.organizationId).not.toBe(orgAData.org.id);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // AC#4: Cross-resource type summary — every tenant-scoped resource
  // ────────────────────────────────────────────────────────────────────

  describe('AC#4: Cross-tenant access blocked for ALL resource types', () => {
    it('Users: CLIENT from Org A gets filter scoped to Org A', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      const tenantUser = createTenantFilterUser(orgAData.client);
      await usersService.findAllForTenant(tenantUser);

      const where = mockPrisma.user.findMany.mock.calls[0][0].where;
      expect(where.organizationId).toBe(orgAData.org.id);
    });

    it('Users: CLIENT from Org B gets filter scoped to Org B', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      const tenantUser = createTenantFilterUser(orgBData.client);
      await usersService.findAllForTenant(tenantUser);

      const where = mockPrisma.user.findMany.mock.calls[0][0].where;
      expect(where.organizationId).toBe(orgBData.org.id);
    });

    it('Organizations: non-existent ID returns NotFoundException', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      await expectTenantIsolated(() =>
        organizationsService.findById(orgBData.org.id),
      );
    });

    it('Invitations: non-existent ID returns NotFoundException', async () => {
      mockPrisma.userInvitation.findUnique.mockResolvedValue(null);

      await expectTenantIsolated(() =>
        invitationsService.findById(orgBData.invitations[0]!.id),
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Tenant filter boundary tests — ensuring the utility itself
  // correctly partitions access
  // ────────────────────────────────────────────────────────────────────

  describe('Tenant filter boundary — Evil Twin partition', () => {
    it('buildTenantFilter produces different filters for Org A and Org B clients', async () => {
      // Org A CLIENT request
      mockPrisma.user.findMany.mockResolvedValue(orgAData.users);
      await usersService.findAllForTenant(
        createTenantFilterUser(orgAData.client),
      );
      const filterA = mockPrisma.user.findMany.mock.calls[0][0].where;

      jest.clearAllMocks();

      // Org B CLIENT request
      mockPrisma.user.findMany.mockResolvedValue(orgBData.users);
      await usersService.findAllForTenant(
        createTenantFilterUser(orgBData.client),
      );
      const filterB = mockPrisma.user.findMany.mock.calls[0][0].where;

      // Filters must be scoped to different orgs
      expect(filterA.organizationId).toBe(orgAData.org.id);
      expect(filterB.organizationId).toBe(orgBData.org.id);
      expect(filterA.organizationId).not.toBe(filterB.organizationId);
    });

    it('SUPER_ADMIN filter has NO organizationId (sees everything)', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      await usersService.findAllForTenant(
        createTenantFilterUser(superAdmin),
      );

      const where = mockPrisma.user.findMany.mock.calls[0][0].where;
      expect(where).not.toHaveProperty('organizationId');
      expect(where).toEqual({ deletedAt: null });
    });
  });
});
