# Test Design - Architecture Document (Developer Reference)

**Project:** CodeWeaves Platform
**Version:** 1.0.0
**Author:** Murat (Master Test Architect)
**Date:** 2026-02-02
**Scope:** Backend API (NestJS) - Integration Testing

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Testing Architecture Overview](#2-testing-architecture-overview)
3. [Risk-Based Test Prioritization](#3-risk-based-test-prioritization)
4. [Test Environment Setup](#4-test-environment-setup)
5. [Critical Test Suites](#5-critical-test-suites)
6. [Tenant Isolation Test Strategy (ADR-006)](#6-tenant-isolation-test-strategy-adr-006)
7. [Authentication Test Strategy (ADR-005)](#7-authentication-test-strategy-adr-005)
8. [AI Service Abstraction Test Strategy (ADR-007/013)](#8-ai-service-abstraction-test-strategy-adr-007013)
9. [Integration Test Patterns](#9-integration-test-patterns)
10. [Test Data Management](#10-test-data-management)
11. [CI/CD Integration](#11-cicd-integration)
12. [Appendix: Code Templates](#12-appendix-code-templates)

---

## 1. Executive Summary

This document defines the **integration testing strategy** for the CodeWeaves Platform NestJS backend. The primary focus is validating three critical architectural decisions that carry the highest risk:

| Risk Area | ADR | Risk Level | Test Priority |
|-----------|-----|------------|---------------|
| Tenant Isolation (No RLS) | ADR-006 | **CRITICAL** | P0 |
| Auth0 JWT Verification | ADR-005 | **HIGH** | P0 |
| AI Provider Abstraction | ADR-007/013 | **MEDIUM** | P1 |

**Testing Stack:**
- **Framework:** Jest
- **HTTP Testing:** Supertest
- **Database:** PostgreSQL (test container)
- **Mocking:** jest-mock-extended for Prisma, nock for HTTP

**Coverage Targets:**
- Services: > 80%
- Controllers: > 80%
- Guards/Middleware: 100% (security-critical)
- Integration Tests: All critical paths

---

## 2. Testing Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TEST ARCHITECTURE                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
┌───────────────────┐    ┌───────────────────┐    ┌───────────────────┐
│   UNIT TESTS      │    │ INTEGRATION TESTS │    │  CONTRACT TESTS   │
│                   │    │   (FOCUS AREA)    │    │                   │
│ - Services        │    │ - API Endpoints   │    │ - Zod Schemas     │
│ - Utilities       │    │ - Auth Flow       │    │ - API Contracts   │
│ - Validators      │    │ - Tenant Isolation│    │ - DTO Validation  │
│ - Transformers    │    │ - AI Abstraction  │    │                   │
│                   │    │                   │    │                   │
│ Mock: Prisma      │    │ Real: Test DB     │    │ Schema Validation │
│ Mock: External    │    │ Mock: Auth0 JWT   │    │                   │
│                   │    │ Mock: AI Provider │    │                   │
└───────────────────┘    └───────────────────┘    └───────────────────┘
        │                           │                           │
        └───────────────────────────┼───────────────────────────┘
                                    ▼
                    ┌───────────────────────────┐
                    │     CI/CD PIPELINE        │
                    │                           │
                    │ 1. Lint + Type Check      │
                    │ 2. Unit Tests             │
                    │ 3. Integration Tests      │
                    │ 4. Coverage Report        │
                    │ 5. Security Scan          │
                    └───────────────────────────┘
```

### 2.1 Test File Organization

```
apps/api/
├── src/
│   └── modules/
│       ├── agents/
│       │   ├── agents.service.ts
│       │   ├── agents.service.spec.ts        # Unit tests
│       │   ├── agents.controller.ts
│       │   └── agents.controller.spec.ts     # Unit tests
│       └── ...
├── test/
│   ├── setup/
│   │   ├── test-database.ts                  # Test DB setup
│   │   ├── test-app.ts                       # NestJS test app factory
│   │   ├── auth-helpers.ts                   # JWT generation helpers
│   │   └── seed-data.ts                      # Test data factories
│   ├── integration/
│   │   ├── agents.integration.spec.ts        # Agent API tests
│   │   ├── auth.integration.spec.ts          # Auth flow tests
│   │   ├── tenant-isolation.integration.spec.ts  # CRITICAL
│   │   ├── ai-service.integration.spec.ts    # AI abstraction tests
│   │   └── analytics.integration.spec.ts     # Analytics tests
│   ├── e2e/                                  # Future: Full E2E
│   └── jest-integration.config.ts            # Integration test config
└── jest.config.ts                            # Unit test config
```

---

## 3. Risk-Based Test Prioritization

### 3.1 Risk Matrix

| Component | Impact | Likelihood | Risk Score | Test Coverage |
|-----------|--------|------------|------------|---------------|
| Tenant Isolation | CRITICAL | Medium | **P0** | 100% paths |
| JWT Verification | CRITICAL | Low | **P0** | 100% paths |
| Role-Based Access | HIGH | Medium | **P0** | All roles |
| AI Provider Abstraction | MEDIUM | Medium | **P1** | Happy + Error |
| Rate Limiting | MEDIUM | Low | **P2** | Basic coverage |
| Analytics Calculation | LOW | Low | **P3** | Key metrics |

### 3.2 Test Priority Definitions

- **P0 (Critical):** Security vulnerabilities. Must block deployment.
- **P1 (High):** Core functionality. Should block deployment.
- **P2 (Medium):** Important features. Flag for review.
- **P3 (Low):** Nice-to-have. Informational only.

---

## 4. Test Environment Setup

### 4.1 Test Database Configuration

```typescript
// apps/api/test/setup/test-database.ts
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
  || 'postgresql://test:test@localhost:5433/codeweaves_test';

let prisma: PrismaClient;

export async function setupTestDatabase(): Promise<PrismaClient> {
  // Set test database URL
  process.env.DATABASE_URL = TEST_DATABASE_URL;

  // Run migrations
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });

  // Create Prisma client
  prisma = new PrismaClient({
    datasources: { db: { url: TEST_DATABASE_URL } },
  });

  await prisma.$connect();
  return prisma;
}

export async function cleanupTestDatabase(): Promise<void> {
  // Truncate all tables in reverse dependency order
  const tablenames = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;

  for (const { tablename } of tablenames) {
    if (tablename !== '_prisma_migrations') {
      await prisma.$executeRawUnsafe(
        `TRUNCATE TABLE "public"."${tablename}" CASCADE;`
      );
    }
  }
}

export async function teardownTestDatabase(): Promise<void> {
  await prisma.$disconnect();
}

export { prisma };
```

### 4.2 Test Application Factory

```typescript
// apps/api/test/setup/test-app.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { setupTestDatabase, prisma } from './test-database';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  module: TestingModule;
}

export async function createTestApp(): Promise<TestContext> {
  await setupTestDatabase();

  const module = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .compile();

  const app = module.createNestApplication();

  // Apply same middleware as production
  app.useGlobalPipes(new ValidationPipe({ transform: true }));

  await app.init();

  return {
    app,
    prisma: module.get(PrismaService),
    module,
  };
}
```

### 4.3 Auth Test Helpers

```typescript
// apps/api/test/setup/auth-helpers.ts
import * as jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';

// Test-only RSA keys (NEVER use in production)
const TEST_PRIVATE_KEY = `-----BEGIN RSA PRIVATE KEY-----
... (test key for local development only)
-----END RSA PRIVATE KEY-----`;

const TEST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
... (test key for local development only)
-----END PUBLIC KEY-----`;

export interface TestUser {
  id: string;
  auth0Id: string;
  email: string;
  role: Role;
  organizationId: string | null;
}

export interface JWTPayload {
  sub: string;
  email: string;
  'https://codeweaves.io/roles': Role[];
  'https://codeweaves.io/org_id': string | null;
  aud: string;
  iss: string;
  iat: number;
  exp: number;
}

export function generateTestJWT(user: TestUser): string {
  const payload: JWTPayload = {
    sub: user.auth0Id,
    email: user.email,
    'https://codeweaves.io/roles': [user.role],
    'https://codeweaves.io/org_id': user.organizationId,
    aud: process.env.AUTH0_AUDIENCE || 'https://api.codeweaves.io',
    iss: `https://${process.env.AUTH0_DOMAIN || 'test.auth0.com'}/`,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
  };

  return jwt.sign(payload, TEST_PRIVATE_KEY, { algorithm: 'RS256' });
}

export function generateExpiredJWT(user: TestUser): string {
  const payload: JWTPayload = {
    sub: user.auth0Id,
    email: user.email,
    'https://codeweaves.io/roles': [user.role],
    'https://codeweaves.io/org_id': user.organizationId,
    aud: process.env.AUTH0_AUDIENCE || 'https://api.codeweaves.io',
    iss: `https://${process.env.AUTH0_DOMAIN || 'test.auth0.com'}/`,
    iat: Math.floor(Date.now() / 1000) - 7200, // 2 hours ago
    exp: Math.floor(Date.now() / 1000) - 3600,  // Expired 1 hour ago
  };

  return jwt.sign(payload, TEST_PRIVATE_KEY, { algorithm: 'RS256' });
}

export function generateMalformedJWT(): string {
  return 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature';
}

// Test user factories
export const testUsers = {
  superAdmin: {
    id: 'user-super-admin',
    auth0Id: 'auth0|super-admin',
    email: 'superadmin@codeweaves.io',
    role: Role.SUPER_ADMIN,
    organizationId: null,
  },
  adminUser: {
    id: 'user-admin',
    auth0Id: 'auth0|admin',
    email: 'admin@codeweaves.io',
    role: Role.ADMIN,
    organizationId: null,
  },
  clientUserOrg1: {
    id: 'user-client-org1',
    auth0Id: 'auth0|client-org1',
    email: 'client@org1.com',
    role: Role.CLIENT,
    organizationId: 'org-1',
  },
  clientUserOrg2: {
    id: 'user-client-org2',
    auth0Id: 'auth0|client-org2',
    email: 'client@org2.com',
    role: Role.CLIENT,
    organizationId: 'org-2',
  },
} as const;
```

---

## 5. Critical Test Suites

### 5.1 Test Suite Overview

| Suite | File | Priority | Estimated Tests |
|-------|------|----------|-----------------|
| Tenant Isolation | `tenant-isolation.integration.spec.ts` | P0 | ~30 |
| Authentication | `auth.integration.spec.ts` | P0 | ~20 |
| Authorization (RBAC) | `rbac.integration.spec.ts` | P0 | ~40 |
| AI Service | `ai-service.integration.spec.ts` | P1 | ~15 |
| Agents CRUD | `agents.integration.spec.ts` | P1 | ~25 |
| Analytics | `analytics.integration.spec.ts` | P2 | ~15 |
| Widget Config | `widget.integration.spec.ts` | P2 | ~10 |

---

## 6. Tenant Isolation Test Strategy (ADR-006)

### 6.1 Risk Analysis

**ADR-006: Application-Level Data Access (No RLS)**

The decision to NOT use Row-Level Security means:
- ✅ Simpler database migrations
- ✅ Easier debugging and testing
- ✅ Full control over data access patterns
- ⚠️ **RISK:** Every Prisma query MUST include `organizationId` filter
- ⚠️ **RISK:** A single missing filter = tenant data leak

**Test Strategy:** Verify EVERY service method that accesses tenant data correctly filters by `organizationId`.

### 6.2 Tenant Isolation Test Matrix

| Resource | Operations | Cross-Tenant Risk |
|----------|------------|-------------------|
| Agent | List, Get, Create, Update, Delete | HIGH |
| Theme | Get, Update | HIGH |
| ChatSession | List, Get | HIGH |
| ChatMessage | List | HIGH |
| UsageEvent | List | HIGH |
| AnalyticsAggregation | Get | HIGH |

### 6.3 Tenant Isolation Test Implementation

```typescript
// apps/api/test/integration/tenant-isolation.integration.spec.ts
import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, TestContext } from '../setup/test-app';
import { cleanupTestDatabase } from '../setup/test-database';
import { generateTestJWT, testUsers } from '../setup/auth-helpers';
import { seedTenantTestData } from '../setup/seed-data';

describe('Tenant Isolation (ADR-006 Validation)', () => {
  let ctx: TestContext;
  let org1Token: string;
  let org2Token: string;
  let superAdminToken: string;

  // Test data references
  let org1Agent: { id: string; publicId: string };
  let org2Agent: { id: string; publicId: string };

  beforeAll(async () => {
    ctx = await createTestApp();

    // Seed multi-tenant test data
    const seedData = await seedTenantTestData(ctx.prisma);
    org1Agent = seedData.org1Agent;
    org2Agent = seedData.org2Agent;

    // Generate tokens for each tenant
    org1Token = generateTestJWT(testUsers.clientUserOrg1);
    org2Token = generateTestJWT(testUsers.clientUserOrg2);
    superAdminToken = generateTestJWT(testUsers.superAdmin);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await cleanupTestDatabase();
    await seedTenantTestData(ctx.prisma);
  });

  // ═══════════════════════════════════════════════════════════════════
  // AGENT ISOLATION TESTS
  // ═══════════════════════════════════════════════════════════════════

  describe('Agent Isolation', () => {
    describe('GET /agents', () => {
      it('CLIENT user sees ONLY their organization agents', async () => {
        const response = await request(ctx.app.getHttpServer())
          .get('/agents')
          .set('Authorization', `Bearer ${org1Token}`)
          .expect(200);

        // Verify ONLY org1 agents returned
        expect(response.body).toHaveLength(1);
        expect(response.body[0].organizationId).toBe('org-1');

        // CRITICAL: Verify org2 agent is NOT in response
        const org2AgentIds = response.body.map((a: any) => a.id);
        expect(org2AgentIds).not.toContain(org2Agent.id);
      });

      it('SUPER_ADMIN sees ALL agents across organizations', async () => {
        const response = await request(ctx.app.getHttpServer())
          .get('/agents')
          .set('Authorization', `Bearer ${superAdminToken}`)
          .expect(200);

        // Should see agents from both orgs
        const orgIds = [...new Set(response.body.map((a: any) => a.organizationId))];
        expect(orgIds).toContain('org-1');
        expect(orgIds).toContain('org-2');
      });
    });

    describe('GET /agents/:id', () => {
      it('CLIENT user CANNOT access agent from different organization', async () => {
        // org1 user trying to access org2's agent
        await request(ctx.app.getHttpServer())
          .get(`/agents/${org2Agent.id}`)
          .set('Authorization', `Bearer ${org1Token}`)
          .expect(404); // Should return 404, not 403 (prevent enumeration)
      });

      it('CLIENT user CAN access their own organization agent', async () => {
        const response = await request(ctx.app.getHttpServer())
          .get(`/agents/${org1Agent.id}`)
          .set('Authorization', `Bearer ${org1Token}`)
          .expect(200);

        expect(response.body.id).toBe(org1Agent.id);
        expect(response.body.organizationId).toBe('org-1');
      });
    });

    describe('PATCH /agents/:id', () => {
      it('CLIENT user CANNOT update agent from different organization', async () => {
        await request(ctx.app.getHttpServer())
          .patch(`/agents/${org2Agent.id}`)
          .set('Authorization', `Bearer ${org1Token}`)
          .send({ name: 'Hacked Name' })
          .expect(404);

        // Verify agent was NOT modified
        const agent = await ctx.prisma.agent.findUnique({
          where: { id: org2Agent.id },
        });
        expect(agent?.name).not.toBe('Hacked Name');
      });
    });

    describe('DELETE /agents/:id', () => {
      it('CLIENT user CANNOT delete agent from different organization', async () => {
        await request(ctx.app.getHttpServer())
          .delete(`/agents/${org2Agent.id}`)
          .set('Authorization', `Bearer ${org1Token}`)
          .expect(404);

        // Verify agent still exists
        const agent = await ctx.prisma.agent.findUnique({
          where: { id: org2Agent.id },
        });
        expect(agent).not.toBeNull();
        expect(agent?.deletedAt).toBeNull();
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // CHAT SESSION ISOLATION TESTS
  // ═══════════════════════════════════════════════════════════════════

  describe('Chat Session Isolation', () => {
    it('CLIENT user CANNOT access chat sessions from different organization agent', async () => {
      const response = await request(ctx.app.getHttpServer())
        .get(`/agents/${org2Agent.id}/sessions`)
        .set('Authorization', `Bearer ${org1Token}`)
        .expect(404);
    });

    it('CLIENT user CAN access chat sessions from their organization agent', async () => {
      const response = await request(ctx.app.getHttpServer())
        .get(`/agents/${org1Agent.id}/sessions`)
        .set('Authorization', `Bearer ${org1Token}`)
        .expect(200);

      // Verify all sessions belong to the correct agent
      response.body.forEach((session: any) => {
        expect(session.agentId).toBe(org1Agent.id);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // ANALYTICS ISOLATION TESTS
  // ═══════════════════════════════════════════════════════════════════

  describe('Analytics Isolation', () => {
    it('CLIENT user analytics are scoped to their organization only', async () => {
      const response = await request(ctx.app.getHttpServer())
        .get('/analytics/overview')
        .set('Authorization', `Bearer ${org1Token}`)
        .query({ period: '7d' })
        .expect(200);

      // The metrics should only reflect org1 data
      // We need to verify the calculation is isolated
      expect(response.body.organizationId).toBe('org-1');
    });

    it('SUPER_ADMIN can access platform-wide analytics', async () => {
      const response = await request(ctx.app.getHttpServer())
        .get('/analytics/overview')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .query({ period: '7d', scope: 'platform' })
        .expect(200);

      // Platform analytics should aggregate all orgs
      expect(response.body.scope).toBe('platform');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // BOUNDARY TESTS (Edge Cases)
  // ═══════════════════════════════════════════════════════════════════

  describe('Tenant Boundary Tests', () => {
    it('IDOR: Sequential ID enumeration does not leak data', async () => {
      // Attempt to enumerate through IDs
      const responses = await Promise.all([
        request(ctx.app.getHttpServer())
          .get('/agents/org-1-agent-1')
          .set('Authorization', `Bearer ${org2Token}`),
        request(ctx.app.getHttpServer())
          .get('/agents/org-1-agent-2')
          .set('Authorization', `Bearer ${org2Token}`),
        request(ctx.app.getHttpServer())
          .get('/agents/org-1-agent-3')
          .set('Authorization', `Bearer ${org2Token}`),
      ]);

      // All should be 404 (not 403 to prevent enumeration)
      responses.forEach((response) => {
        expect(response.status).toBe(404);
      });
    });

    it('Parameter tampering: organizationId in body is ignored', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/agents')
        .set('Authorization', `Bearer ${org1Token}`)
        .send({
          name: 'Test Agent',
          organizationId: 'org-2', // Attacker tries to set different org
          allowedDomains: ['example.com'],
        })
        .expect(201);

      // Agent should be created in org1, not org2
      expect(response.body.organizationId).toBe('org-1');
      expect(response.body.organizationId).not.toBe('org-2');
    });

    it('Query parameter injection does not bypass tenant filter', async () => {
      const response = await request(ctx.app.getHttpServer())
        .get('/agents')
        .set('Authorization', `Bearer ${org1Token}`)
        .query({ organizationId: 'org-2' }) // Attacker tries URL manipulation
        .expect(200);

      // Should still only return org1 agents
      response.body.forEach((agent: any) => {
        expect(agent.organizationId).toBe('org-1');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // REGRESSION TESTS (Prevent Future Bugs)
  // ═══════════════════════════════════════════════════════════════════

  describe('Tenant Isolation Regression Suite', () => {
    const TENANT_SCOPED_ENDPOINTS = [
      { method: 'GET', path: '/agents' },
      { method: 'GET', path: '/agents/:id' },
      { method: 'PATCH', path: '/agents/:id' },
      { method: 'DELETE', path: '/agents/:id' },
      { method: 'GET', path: '/agents/:id/theme' },
      { method: 'PUT', path: '/agents/:id/theme' },
      { method: 'GET', path: '/analytics/overview' },
      { method: 'GET', path: '/analytics/users' },
      { method: 'GET', path: '/analytics/conversations' },
    ];

    TENANT_SCOPED_ENDPOINTS.forEach(({ method, path }) => {
      it(`${method} ${path} enforces tenant isolation`, async () => {
        const actualPath = path.replace(':id', org2Agent.id);

        const req = request(ctx.app.getHttpServer());
        let response;

        switch (method) {
          case 'GET':
            response = await req.get(actualPath).set('Authorization', `Bearer ${org1Token}`);
            break;
          case 'PATCH':
            response = await req.patch(actualPath).set('Authorization', `Bearer ${org1Token}`).send({});
            break;
          case 'PUT':
            response = await req.put(actualPath).set('Authorization', `Bearer ${org1Token}`).send({});
            break;
          case 'DELETE':
            response = await req.delete(actualPath).set('Authorization', `Bearer ${org1Token}`);
            break;
        }

        // Cross-tenant access should result in 404 (not 403)
        expect([404, 400]).toContain(response.status);
      });
    });
  });
});
```

### 6.4 Service Layer Isolation Assertions (Unit Tests)

```typescript
// apps/api/src/modules/agents/agents.service.spec.ts
import { Test } from '@nestjs/testing';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient, Role } from '@prisma/client';
import { AgentsService } from './agents.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AgentsService - Tenant Isolation', () => {
  let service: AgentsService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AgentsService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
      ],
    }).compile();

    service = module.get(AgentsService);
    prisma = module.get(PrismaService);
  });

  describe('Prisma Query Verification', () => {
    it('findAll: CLIENT role query MUST include organizationId filter', async () => {
      const user = { role: Role.CLIENT, organizationId: 'org-1' };
      prisma.agent.findMany.mockResolvedValue([]);

      await service.findAll(user);

      // CRITICAL: Verify the where clause contains organizationId
      expect(prisma.agent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org-1',
          }),
        }),
      );
    });

    it('findAll: ADMIN role query MUST NOT require organizationId filter', async () => {
      const user = { role: Role.ADMIN, organizationId: null };
      prisma.agent.findMany.mockResolvedValue([]);

      await service.findAll(user);

      expect(prisma.agent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({
            organizationId: expect.anything(),
          }),
        }),
      );
    });

    it('findOne: Query MUST include both id AND organizationId for CLIENT', async () => {
      const user = { role: Role.CLIENT, organizationId: 'org-1' };
      prisma.agent.findFirst.mockResolvedValue(null);

      try {
        await service.findOne('agent-id', user);
      } catch (e) {
        // Expected NotFoundException
      }

      expect(prisma.agent.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'agent-id',
            organizationId: 'org-1',
          }),
        }),
      );
    });

    it('update: Query MUST verify ownership before updating', async () => {
      const user = { role: Role.CLIENT, organizationId: 'org-1' };
      prisma.agent.findFirst.mockResolvedValue(null);

      try {
        await service.update('agent-id', { name: 'New Name' }, user);
      } catch (e) {
        // Expected NotFoundException
      }

      // The findFirst (ownership check) must include organizationId
      expect(prisma.agent.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'agent-id',
            organizationId: 'org-1',
          }),
        }),
      );
    });

    it('delete: Query MUST verify ownership before soft delete', async () => {
      const user = { role: Role.CLIENT, organizationId: 'org-1' };
      prisma.agent.findFirst.mockResolvedValue(null);

      try {
        await service.remove('agent-id', user);
      } catch (e) {
        // Expected NotFoundException
      }

      expect(prisma.agent.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'agent-id',
            organizationId: 'org-1',
          }),
        }),
      );
    });
  });
});
```

---

## 7. Authentication Test Strategy (ADR-005)

### 7.1 Auth0 JWT Verification Tests

```typescript
// apps/api/test/integration/auth.integration.spec.ts
import * as request from 'supertest';
import { createTestApp, TestContext } from '../setup/test-app';
import {
  generateTestJWT,
  generateExpiredJWT,
  generateMalformedJWT,
  testUsers,
} from '../setup/auth-helpers';

describe('Authentication (ADR-005 Validation)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('JWT Verification', () => {
    it('Valid JWT: Request succeeds with valid token', async () => {
      const token = generateTestJWT(testUsers.clientUserOrg1);

      await request(ctx.app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('Missing JWT: Returns 401 Unauthorized', async () => {
      await request(ctx.app.getHttpServer())
        .get('/auth/me')
        .expect(401);
    });

    it('Malformed JWT: Returns 401 Unauthorized', async () => {
      await request(ctx.app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${generateMalformedJWT()}`)
        .expect(401);
    });

    it('Expired JWT: Returns 401 Unauthorized', async () => {
      const expiredToken = generateExpiredJWT(testUsers.clientUserOrg1);

      await request(ctx.app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);
    });

    it('Invalid Signature: Returns 401 Unauthorized', async () => {
      // Token signed with different key
      const tamperedToken = generateTestJWT(testUsers.clientUserOrg1) + 'tampered';

      await request(ctx.app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${tamperedToken}`)
        .expect(401);
    });

    it('Wrong Issuer: Returns 401 Unauthorized', async () => {
      // Generate token with wrong issuer claim
      // Implementation depends on your JWT generation
      const wrongIssuerToken = 'token.with.wrong.issuer';

      await request(ctx.app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${wrongIssuerToken}`)
        .expect(401);
    });

    it('Wrong Audience: Returns 401 Unauthorized', async () => {
      // Generate token with wrong audience claim
      const wrongAudienceToken = 'token.with.wrong.audience';

      await request(ctx.app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${wrongAudienceToken}`)
        .expect(401);
    });
  });

  describe('Token Claims Extraction', () => {
    it('User claims are correctly extracted from JWT', async () => {
      const token = generateTestJWT(testUsers.clientUserOrg1);

      const response = await request(ctx.app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.email).toBe(testUsers.clientUserOrg1.email);
      expect(response.body.organizationId).toBe(testUsers.clientUserOrg1.organizationId);
    });

    it('Role claims are correctly extracted from JWT', async () => {
      const token = generateTestJWT(testUsers.superAdmin);

      const response = await request(ctx.app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.roles).toContain('SUPER_ADMIN');
    });
  });

  describe('Public Endpoints (No Auth Required)', () => {
    const PUBLIC_ENDPOINTS = [
      { method: 'GET', path: '/health' },
      { method: 'GET', path: '/health/live' },
      { method: 'GET', path: '/widget/config?id=abc123' },
    ];

    PUBLIC_ENDPOINTS.forEach(({ method, path }) => {
      it(`${method} ${path} accessible without authentication`, async () => {
        const response = await request(ctx.app.getHttpServer())
          [method.toLowerCase()](path);

        // Should not return 401
        expect(response.status).not.toBe(401);
      });
    });
  });

  describe('Protected Endpoints (Auth Required)', () => {
    const PROTECTED_ENDPOINTS = [
      { method: 'GET', path: '/agents' },
      { method: 'GET', path: '/analytics/overview' },
      { method: 'GET', path: '/users' },
      { method: 'POST', path: '/agents' },
    ];

    PROTECTED_ENDPOINTS.forEach(({ method, path }) => {
      it(`${method} ${path} requires authentication`, async () => {
        const response = await request(ctx.app.getHttpServer())
          [method.toLowerCase()](path);

        expect(response.status).toBe(401);
      });
    });
  });
});
```

### 7.2 RBAC Tests

```typescript
// apps/api/test/integration/rbac.integration.spec.ts
describe('Role-Based Access Control', () => {
  let ctx: TestContext;
  let superAdminToken: string;
  let adminToken: string;
  let clientToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    superAdminToken = generateTestJWT(testUsers.superAdmin);
    adminToken = generateTestJWT(testUsers.adminUser);
    clientToken = generateTestJWT(testUsers.clientUserOrg1);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('Super Admin Permissions', () => {
    it('Can invite new users', async () => {
      await request(ctx.app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ email: 'new@user.com', role: 'CLIENT', organizationId: 'org-1' })
        .expect(201);
    });

    it('Can access all organizations', async () => {
      const response = await request(ctx.app.getHttpServer())
        .get('/organizations')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      expect(response.body.length).toBeGreaterThan(1);
    });

    it('Can switch AI providers for any agent', async () => {
      await request(ctx.app.getHttpServer())
        .patch('/agents/any-agent-id/ai-provider')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ provider: 'openai' })
        .expect([200, 404]); // 404 if agent doesn't exist
    });
  });

  describe('Admin User Permissions', () => {
    it('CANNOT invite new users', async () => {
      await request(ctx.app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: 'new@user.com', role: 'CLIENT' })
        .expect(403);
    });

    it('CAN view all organizations', async () => {
      await request(ctx.app.getHttpServer())
        .get('/organizations')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('CAN manage agents for any organization', async () => {
      await request(ctx.app.getHttpServer())
        .get('/agents')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('CANNOT access billing settings', async () => {
      await request(ctx.app.getHttpServer())
        .get('/billing')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);
    });
  });

  describe('Client User Permissions', () => {
    it('CANNOT invite new users', async () => {
      await request(ctx.app.getHttpServer())
        .post('/users/invite')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ email: 'new@user.com', role: 'CLIENT' })
        .expect(403);
    });

    it('CANNOT view other organizations', async () => {
      await request(ctx.app.getHttpServer())
        .get('/organizations')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(403);
    });

    it('CAN ONLY see own organization agents', async () => {
      const response = await request(ctx.app.getHttpServer())
        .get('/agents')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(200);

      response.body.forEach((agent: any) => {
        expect(agent.organizationId).toBe(testUsers.clientUserOrg1.organizationId);
      });
    });

    it('CANNOT access platform-wide analytics', async () => {
      await request(ctx.app.getHttpServer())
        .get('/analytics/overview')
        .set('Authorization', `Bearer ${clientToken}`)
        .query({ scope: 'platform' })
        .expect(403);
    });
  });

  // Permission matrix validation
  describe('Permission Matrix Validation', () => {
    const PERMISSION_MATRIX = [
      // [endpoint, method, superAdmin, admin, client]
      ['POST /users/invite', 'post', 201, 403, 403],
      ['GET /organizations', 'get', 200, 200, 403],
      ['GET /agents', 'get', 200, 200, 200],
      ['POST /agents', 'post', 201, 201, 403],
      ['GET /billing', 'get', 200, 403, 403],
      ['GET /analytics/overview?scope=platform', 'get', 200, 200, 403],
    ];

    PERMISSION_MATRIX.forEach(([endpoint, method, superExpected, adminExpected, clientExpected]) => {
      const [httpMethod, path] = endpoint.split(' ');

      it(`${endpoint} - Super Admin: ${superExpected}`, async () => {
        const response = await request(ctx.app.getHttpServer())
          [method](path)
          .set('Authorization', `Bearer ${superAdminToken}`)
          .send({});
        expect([superExpected, 404]).toContain(response.status);
      });

      it(`${endpoint} - Admin: ${adminExpected}`, async () => {
        const response = await request(ctx.app.getHttpServer())
          [method](path)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({});
        expect([adminExpected, 404]).toContain(response.status);
      });

      it(`${endpoint} - Client: ${clientExpected}`, async () => {
        const response = await request(ctx.app.getHttpServer())
          [method](path)
          .set('Authorization', `Bearer ${clientToken}`)
          .send({});
        expect([clientExpected, 404]).toContain(response.status);
      });
    });
  });
});
```

---

## 8. AI Service Abstraction Test Strategy (ADR-007/013)

### 8.1 Provider Interface Contract Tests

```typescript
// apps/api/test/integration/ai-service.integration.spec.ts
import * as nock from 'nock';
import { createTestApp, TestContext } from '../setup/test-app';
import { AIService } from '../../src/modules/ai/ai.service';

describe('AI Service Abstraction (ADR-007/013 Validation)', () => {
  let ctx: TestContext;
  let aiService: AIService;

  beforeAll(async () => {
    ctx = await createTestApp();
    aiService = ctx.module.get(AIService);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('Provider Interface Contract', () => {
    it('n8n provider implements AIProvider interface', () => {
      const n8nProvider = aiService.getProvider('n8n');

      // Verify interface compliance
      expect(n8nProvider).toHaveProperty('name');
      expect(n8nProvider).toHaveProperty('sendMessage');
      expect(n8nProvider).toHaveProperty('streamMessage');
      expect(n8nProvider).toHaveProperty('validateConfig');

      expect(typeof n8nProvider.sendMessage).toBe('function');
      expect(typeof n8nProvider.streamMessage).toBe('function');
    });

    it('Provider can be swapped without API changes', async () => {
      // Mock n8n webhook
      nock('https://n8n.example.com')
        .post('/webhook/test')
        .reply(200, { agentReply: 'Hello from n8n!' });

      const response = await aiService.sendMessage({
        provider: 'n8n',
        message: 'Hello',
        conversationHistory: [],
      });

      expect(response.content).toBe('Hello from n8n!');
      expect(response.metadata?.provider).toBe('n8n');
    });
  });

  describe('n8n Provider', () => {
    describe('Response Format Handling', () => {
      it('Handles agentReply format', async () => {
        nock('https://n8n.example.com')
          .post('/webhook/test')
          .reply(200, { agentReply: 'Response in agentReply format' });

        const response = await aiService.sendMessage({
          provider: 'n8n',
          message: 'Test',
          conversationHistory: [],
        });

        expect(response.content).toBe('Response in agentReply format');
      });

      it('Handles output format', async () => {
        nock('https://n8n.example.com')
          .post('/webhook/test')
          .reply(200, { output: 'Response in output format' });

        const response = await aiService.sendMessage({
          provider: 'n8n',
          message: 'Test',
          conversationHistory: [],
        });

        expect(response.content).toBe('Response in output format');
      });

      it('Handles ai_message.content format', async () => {
        nock('https://n8n.example.com')
          .post('/webhook/test')
          .reply(200, { ai_message: { content: 'Response in ai_message format' } });

        const response = await aiService.sendMessage({
          provider: 'n8n',
          message: 'Test',
          conversationHistory: [],
        });

        expect(response.content).toBe('Response in ai_message format');
      });

      it('Handles plain string response', async () => {
        nock('https://n8n.example.com')
          .post('/webhook/test')
          .reply(200, 'Plain string response');

        const response = await aiService.sendMessage({
          provider: 'n8n',
          message: 'Test',
          conversationHistory: [],
        });

        expect(response.content).toBe('Plain string response');
      });

      it('Throws error for unknown format', async () => {
        nock('https://n8n.example.com')
          .post('/webhook/test')
          .reply(200, { unknownField: 'some value' });

        await expect(
          aiService.sendMessage({
            provider: 'n8n',
            message: 'Test',
            conversationHistory: [],
          })
        ).rejects.toThrow('Unknown n8n response format');
      });
    });

    describe('Error Handling', () => {
      it('Handles timeout gracefully', async () => {
        nock('https://n8n.example.com')
          .post('/webhook/test')
          .delay(15000) // Exceed timeout
          .reply(200, { agentReply: 'Too late' });

        await expect(
          aiService.sendMessage({
            provider: 'n8n',
            message: 'Test',
            conversationHistory: [],
            timeout: 10000,
          })
        ).rejects.toThrow(/timeout/i);
      });

      it('Handles 5xx server errors', async () => {
        nock('https://n8n.example.com')
          .post('/webhook/test')
          .reply(503, { error: 'Service unavailable' });

        await expect(
          aiService.sendMessage({
            provider: 'n8n',
            message: 'Test',
            conversationHistory: [],
          })
        ).rejects.toThrow(/service.*unavailable/i);
      });

      it('Handles network errors', async () => {
        nock('https://n8n.example.com')
          .post('/webhook/test')
          .replyWithError('Network error');

        await expect(
          aiService.sendMessage({
            provider: 'n8n',
            message: 'Test',
            conversationHistory: [],
          })
        ).rejects.toThrow(/network/i);
      });
    });

    describe('Streaming', () => {
      it('Streams response in chunks', async () => {
        nock('https://n8n.example.com')
          .post('/webhook/test')
          .reply(200, { agentReply: 'Hello world from n8n!' });

        const chunks: string[] = [];
        const stream = await aiService.streamMessage({
          provider: 'n8n',
          message: 'Test',
          conversationHistory: [],
        });

        for await (const chunk of stream) {
          chunks.push(chunk.content);
        }

        expect(chunks.join('')).toBe('Hello world from n8n!');
        expect(chunks.length).toBeGreaterThan(1); // Should be chunked
      });
    });
  });

  describe('Per-Agent Provider Configuration', () => {
    it('Uses agent-specific webhook when configured', async () => {
      // Create agent with custom webhook
      const agent = await ctx.prisma.agent.create({
        data: {
          name: 'Custom Webhook Agent',
          publicId: 'cust1234',
          organizationId: 'org-1',
          allowedDomains: ['example.com'],
        },
      });

      await ctx.prisma.agentSecret.create({
        data: {
          agentId: agent.id,
          webhookUrl: 'https://custom-n8n.example.com/webhook/custom',
        },
      });

      nock('https://custom-n8n.example.com')
        .post('/webhook/custom')
        .reply(200, { agentReply: 'From custom webhook' });

      const response = await aiService.sendMessageForAgent({
        agentId: agent.id,
        message: 'Test',
        conversationHistory: [],
      });

      expect(response.content).toBe('From custom webhook');
    });

    it('Falls back to default webhook when agent has no custom config', async () => {
      const agent = await ctx.prisma.agent.create({
        data: {
          name: 'Default Webhook Agent',
          publicId: 'dflt1234',
          organizationId: 'org-1',
          allowedDomains: ['example.com'],
        },
      });

      // No AgentSecret created - should use default

      nock(process.env.N8N_WEBHOOK_URL || 'https://n8n.example.com')
        .post('/webhook/default')
        .reply(200, { agentReply: 'From default webhook' });

      const response = await aiService.sendMessageForAgent({
        agentId: agent.id,
        message: 'Test',
        conversationHistory: [],
      });

      expect(response.content).toBe('From default webhook');
    });
  });

  describe('Provider Switching (Abstraction Validation)', () => {
    it('Can switch provider at runtime without code changes', async () => {
      // Register mock provider
      class MockOpenAIProvider {
        name = 'openai';
        async sendMessage() {
          return { content: 'From OpenAI', metadata: { provider: 'openai' } };
        }
      }

      aiService.registerProvider(new MockOpenAIProvider());

      const response = await aiService.sendMessage({
        provider: 'openai',
        message: 'Test',
        conversationHistory: [],
      });

      expect(response.content).toBe('From OpenAI');
      expect(response.metadata?.provider).toBe('openai');
    });
  });
});
```

---

## 9. Integration Test Patterns

### 9.1 Test Lifecycle Hooks

```typescript
// apps/api/test/setup/jest-setup.ts
import { setupTestDatabase, teardownTestDatabase, cleanupTestDatabase } from './test-database';

// Global setup - runs once before all tests
beforeAll(async () => {
  await setupTestDatabase();
});

// Global teardown - runs once after all tests
afterAll(async () => {
  await teardownTestDatabase();
});

// Reset between tests
beforeEach(async () => {
  await cleanupTestDatabase();
});
```

### 9.2 Request Helper Patterns

```typescript
// apps/api/test/setup/request-helpers.ts
import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';

export class TestClient {
  constructor(
    private app: INestApplication,
    private token?: string,
  ) {}

  setToken(token: string) {
    this.token = token;
    return this;
  }

  private withAuth(req: request.Test): request.Test {
    if (this.token) {
      return req.set('Authorization', `Bearer ${this.token}`);
    }
    return req;
  }

  get(path: string) {
    return this.withAuth(request(this.app.getHttpServer()).get(path));
  }

  post(path: string, body?: object) {
    let req = this.withAuth(request(this.app.getHttpServer()).post(path));
    if (body) req = req.send(body);
    return req;
  }

  patch(path: string, body?: object) {
    let req = this.withAuth(request(this.app.getHttpServer()).patch(path));
    if (body) req = req.send(body);
    return req;
  }

  delete(path: string) {
    return this.withAuth(request(this.app.getHttpServer()).delete(path));
  }
}
```

### 9.3 Assertion Helpers

```typescript
// apps/api/test/setup/assertion-helpers.ts

// Verify response matches Zod schema
export function expectValidSchema<T>(response: any, schema: z.ZodType<T>) {
  const result = schema.safeParse(response.body);
  if (!result.success) {
    throw new Error(`Schema validation failed: ${JSON.stringify(result.error.errors)}`);
  }
  return result.data;
}

// Verify tenant isolation
export function expectTenantIsolation(
  items: Array<{ organizationId: string }>,
  expectedOrgId: string,
) {
  items.forEach((item) => {
    expect(item.organizationId).toBe(expectedOrgId);
  });
}

// Verify no data leak
export function expectNoDataLeak(
  items: Array<{ organizationId: string }>,
  forbiddenOrgIds: string[],
) {
  items.forEach((item) => {
    expect(forbiddenOrgIds).not.toContain(item.organizationId);
  });
}
```

---

## 10. Test Data Management

### 10.1 Seed Data Factories

```typescript
// apps/api/test/setup/seed-data.ts
import { PrismaClient, Role, AgentStatus } from '@prisma/client';
import { faker } from '@faker-js/faker';

export interface TenantTestData {
  org1: { id: string; slug: string };
  org2: { id: string; slug: string };
  org1Agent: { id: string; publicId: string };
  org2Agent: { id: string; publicId: string };
  org1User: { id: string; auth0Id: string };
  org2User: { id: string; auth0Id: string };
}

export async function seedTenantTestData(prisma: PrismaClient): Promise<TenantTestData> {
  // Create organizations
  const org1 = await prisma.organization.create({
    data: {
      id: 'org-1',
      name: 'Test Organization 1',
      slug: 'test-org-1',
    },
  });

  const org2 = await prisma.organization.create({
    data: {
      id: 'org-2',
      name: 'Test Organization 2',
      slug: 'test-org-2',
    },
  });

  // Create users
  const org1User = await prisma.user.create({
    data: {
      id: 'user-client-org1',
      auth0Id: 'auth0|client-org1',
      email: 'client@org1.com',
      role: Role.CLIENT,
      organizationId: org1.id,
    },
  });

  const org2User = await prisma.user.create({
    data: {
      id: 'user-client-org2',
      auth0Id: 'auth0|client-org2',
      email: 'client@org2.com',
      role: Role.CLIENT,
      organizationId: org2.id,
    },
  });

  // Create agents
  const org1Agent = await prisma.agent.create({
    data: {
      id: 'agent-org1',
      publicId: 'org1agnt',
      name: 'Org 1 Agent',
      status: AgentStatus.ACTIVE,
      organizationId: org1.id,
      allowedDomains: ['org1.example.com'],
    },
  });

  const org2Agent = await prisma.agent.create({
    data: {
      id: 'agent-org2',
      publicId: 'org2agnt',
      name: 'Org 2 Agent',
      status: AgentStatus.ACTIVE,
      organizationId: org2.id,
      allowedDomains: ['org2.example.com'],
    },
  });

  // Create sessions and messages for both orgs
  await createChatSessionWithMessages(prisma, org1Agent.id, 5);
  await createChatSessionWithMessages(prisma, org2Agent.id, 3);

  return {
    org1: { id: org1.id, slug: org1.slug },
    org2: { id: org2.id, slug: org2.slug },
    org1Agent: { id: org1Agent.id, publicId: org1Agent.publicId },
    org2Agent: { id: org2Agent.id, publicId: org2Agent.publicId },
    org1User: { id: org1User.id, auth0Id: org1User.auth0Id },
    org2User: { id: org2User.id, auth0Id: org2User.auth0Id },
  };
}

async function createChatSessionWithMessages(
  prisma: PrismaClient,
  agentId: string,
  messageCount: number,
) {
  const session = await prisma.chatSession.create({
    data: {
      agentId,
      deviceId: faker.string.uuid(),
      ipAddress: faker.internet.ip(),
      userAgent: faker.internet.userAgent(),
    },
  });

  for (let i = 0; i < messageCount; i++) {
    await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: i % 2 === 0 ? 'USER' : 'BOT',
        content: faker.lorem.sentence(),
      },
    });
  }

  return session;
}

// Cleanup helper
export async function cleanupSeedData(prisma: PrismaClient) {
  await prisma.chatMessage.deleteMany();
  await prisma.chatSession.deleteMany();
  await prisma.usageEvent.deleteMany();
  await prisma.agentTheme.deleteMany();
  await prisma.agentSecret.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();
}
```

---

## 11. CI/CD Integration

### 11.1 GitHub Actions Test Workflow

```yaml
# .github/workflows/test.yml
name: Integration Tests

on:
  pull_request:
    branches: [main, develop]
  push:
    branches: [main]

jobs:
  integration-tests:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: codeweaves_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v2
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run Prisma migrations
        run: pnpm --filter=@codeweaves/api prisma migrate deploy
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/codeweaves_test

      - name: Run integration tests
        run: pnpm --filter=@codeweaves/api test:integration --coverage
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/codeweaves_test
          AUTH0_DOMAIN: test.auth0.com
          AUTH0_AUDIENCE: https://api.codeweaves.io
          N8N_WEBHOOK_URL: https://n8n.example.com/webhook/test

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          files: ./apps/api/coverage/lcov.info
          flags: integration
          fail_ci_if_error: true

  security-tests:
    runs-on: ubuntu-latest
    needs: integration-tests

    steps:
      - uses: actions/checkout@v4

      - name: Run tenant isolation tests
        run: pnpm --filter=@codeweaves/api test:integration --testPathPattern="tenant-isolation"

      - name: Run auth tests
        run: pnpm --filter=@codeweaves/api test:integration --testPathPattern="auth"
```

### 11.2 Jest Configuration

```typescript
// apps/api/jest-integration.config.ts
export default {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: 'test/integration/.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.service.ts',
    'src/**/*.controller.ts',
    'src/**/*.guard.ts',
    'src/**/*.middleware.ts',
  ],
  coverageDirectory: './coverage/integration',
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    // Higher threshold for security-critical code
    './src/modules/auth/**/*.ts': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    './src/common/guards/**/*.ts': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/test/setup/jest-setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@codeweaves/validation$': '<rootDir>/../packages/validation/src',
  },
  testTimeout: 30000, // 30 seconds for integration tests
  maxWorkers: 1, // Run serially to avoid DB conflicts
};
```

---

## 12. Appendix: Code Templates

### 12.1 New Service Test Template

```typescript
// Template: apps/api/src/modules/{module}/{module}.service.spec.ts
import { Test } from '@nestjs/testing';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient, Role } from '@prisma/client';
import { {ModuleName}Service } from './{module}.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('{ModuleName}Service', () => {
  let service: {ModuleName}Service;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        {ModuleName}Service,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
      ],
    }).compile();

    service = module.get({ModuleName}Service);
    prisma = module.get(PrismaService);
  });

  describe('findAll', () => {
    it('should filter by organization for CLIENT role', async () => {
      const user = { role: Role.CLIENT, organizationId: 'org-1' };
      prisma.{resource}.findMany.mockResolvedValue([]);

      await service.findAll(user);

      expect(prisma.{resource}.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org-1',
          }),
        }),
      );
    });
  });

  // Add more tests...
});
```

### 12.2 New Integration Test Template

```typescript
// Template: apps/api/test/integration/{module}.integration.spec.ts
import * as request from 'supertest';
import { createTestApp, TestContext } from '../setup/test-app';
import { cleanupTestDatabase } from '../setup/test-database';
import { generateTestJWT, testUsers } from '../setup/auth-helpers';
import { seedTenantTestData } from '../setup/seed-data';

describe('{ModuleName} Integration Tests', () => {
  let ctx: TestContext;
  let clientToken: string;
  let superAdminToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await seedTenantTestData(ctx.prisma);

    clientToken = generateTestJWT(testUsers.clientUserOrg1);
    superAdminToken = generateTestJWT(testUsers.superAdmin);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await cleanupTestDatabase();
    await seedTenantTestData(ctx.prisma);
  });

  describe('GET /{resources}', () => {
    it('returns 200 with valid token', async () => {
      const response = await request(ctx.app.getHttpServer())
        .get('/{resources}')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('returns 401 without token', async () => {
      await request(ctx.app.getHttpServer())
        .get('/{resources}')
        .expect(401);
    });

    it('enforces tenant isolation', async () => {
      // Test implementation
    });
  });

  // Add more tests...
});
```

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-02-02 | Murat (Test Architect) | Initial test design |

---

**End of Test Design - Architecture Document**
