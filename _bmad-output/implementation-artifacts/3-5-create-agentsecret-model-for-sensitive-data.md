# Story 3.5: Create AgentSecret Model for Sensitive Data

Status: done

> **Prerequisite:** Story 3-1 (Agent Model & Schema) must be complete.

## Story

As a **backend developer**,
I want secure encrypted storage for agent secrets (webhook URLs, API keys),
so that sensitive configuration is protected at rest and only decrypted when needed.

## Acceptance Criteria

1. **AC1:** `AgentSecret` Prisma model stores: `id` (UUID), `agentId` (FK, unique 1:1), `webhookUrl` (encrypted text), `apiKey` (encrypted text, nullable), `createdAt`, `updatedAt`
2. **AC2:** One-to-one relation between `Agent` and `AgentSecret` — an agent has at most one secret record
3. **AC3:** All sensitive fields are encrypted with AES-256-GCM before storage
4. **AC4:** Encryption key is read from `AGENT_SECRET_KEY` environment variable (32-byte hex string)
5. **AC5:** A `CryptoService` utility handles encrypt/decrypt with unique IV per operation
6. **AC6:** Decryption only happens when the value is explicitly requested (not on list queries)
7. **AC7:** Prisma migration creates the table successfully
8. **AC8:** If `AGENT_SECRET_KEY` is missing, the application fails fast at startup with a clear error
9. **AC9:** Unit tests verify encrypt → decrypt roundtrip, invalid key rejection, and IV uniqueness
10. **AC10:** The encrypted value format is: `iv:ciphertext` (hex-encoded, colon-separated)

## Tasks / Subtasks

- [x] **Task 1: Prisma Schema** (AC: 1, 2, 7)
  - [x] 1.1 Add `AgentSecret` model to `schema.prisma`
  - [x] 1.2 Add `secret AgentSecret?` relation on `Agent` model
  - [x] 1.3 Run `bunx prisma migrate dev --name add-agent-secret-model`
  - [x] 1.4 Verify migration SQL

- [x] **Task 2: CryptoService** (AC: 3, 4, 5, 8, 10)
  - [x] 2.1 Create `apps/api/src/common/crypto/crypto.service.ts`
  - [x] 2.2 Implement `encrypt(plaintext: string): string` — returns `iv:ciphertext:tag`
  - [x] 2.3 Implement `decrypt(encrypted: string): string` — splits `iv:ciphertext:tag`, decrypts
  - [x] 2.4 Read `AGENT_SECRET_KEY` from `ConfigService`, validate 32-byte hex on module init
  - [x] 2.5 Create `apps/api/src/common/crypto/crypto.module.ts`
  - [x] 2.6 Register `CryptoModule` as a global module in `AppModule`

- [x] **Task 3: Environment Configuration** (AC: 4, 8)
  - [x] 3.1 Add `AGENT_SECRET_KEY` to `.env.example` with generation instructions
  - [x] 3.2 Add validation in `CryptoService.onModuleInit()` — throw if missing or wrong length
  - [ ] 3.3 Add to env schema in `@repo/validation` if applicable (deferred — not needed for runtime)

- [x] **Task 4: AgentSecret Logger Events** (AC: 9)
  - [x] 4.1 Add audit events to `AgentLoggerService`: `AGENT_SECRET_CREATED`, `AGENT_SECRET_UPDATED`
  - [x] 4.2 NEVER log decrypted values — only log that the secret was created/updated

- [x] **Task 5: Unit Tests** (AC: 9)
  - [x] 5.1 Create `apps/api/test/common/crypto/crypto.service.spec.ts`
  - [x] 5.2 Test encrypt → decrypt roundtrip produces original plaintext
  - [x] 5.3 Test each encrypt call produces a different IV (non-deterministic)
  - [x] 5.4 Test decrypt with wrong key throws error
  - [x] 5.5 Test decrypt with tampered ciphertext throws error
  - [x] 5.6 Test missing `AGENT_SECRET_KEY` throws on module init
  - [x] 5.7 Test invalid key length (not 32 bytes) throws on module init

## Dev Notes

### Prisma Schema — AgentSecret Model

```prisma
model AgentSecret {
  id         String   @id @default(uuid())
  agentId    String   @unique
  agent      Agent    @relation(fields: [agentId], references: [id], onDelete: Cascade)
  webhookUrl String?  @db.Text
  apiKey     String?  @db.Text
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([agentId])
  @@map("agent_secrets")
}
```

Add to `Agent` model:
```prisma
secret AgentSecret?
```

### CryptoService Implementation

Create `apps/api/src/common/crypto/crypto.service.ts`:

```typescript
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

@Injectable()
export class CryptoService implements OnModuleInit {
  private readonly logger = new Logger(CryptoService.name);
  private key: Buffer;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const hex = this.configService.get<string>('AGENT_SECRET_KEY');
    if (!hex) throw new Error('AGENT_SECRET_KEY environment variable is required');
    this.key = Buffer.from(hex, 'hex');
    if (this.key.length !== 32) {
      throw new Error('AGENT_SECRET_KEY must be a 64-character hex string (32 bytes)');
    }
    this.logger.log('CryptoService initialized');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${encrypted.toString('hex')}:${tag.toString('hex')}`;
  }

  decrypt(encrypted: string): string {
    const [ivHex, dataHex, tagHex] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(data) + decipher.final('utf8');
  }
}
```

> **Note:** Format is `iv:ciphertext:authTag` (three parts) for GCM mode. The AC says `iv:ciphertext` but GCM requires an auth tag — use three parts.

### CryptoModule

```typescript
import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';

@Global()
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
```

### Environment Variable

Add to `.env.example`:
```
# 32-byte hex key for encrypting agent secrets (generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
AGENT_SECRET_KEY=
```

Generate a key for local dev `.env`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Security Rules

- **NEVER** log decrypted values, webhook URLs, or API keys
- **NEVER** return decrypted secrets in list endpoints — only in targeted get-secret calls
- **NEVER** include secrets in audit log `data` field — only log the event name
- The `onDelete: Cascade` ensures secrets are deleted when an agent is deleted

### File Structure

```
apps/api/
├── prisma/schema.prisma                              # MODIFIED — add AgentSecret model
├── src/common/crypto/
│   ├── crypto.service.ts                              # NEW
│   └── crypto.module.ts                               # NEW
├── src/common/logger/agent.logger.ts                  # MODIFIED — add secret events
└── src/modules/app.module.ts                          # MODIFIED — import CryptoModule
apps/api/test/common/crypto/
└── crypto.service.spec.ts                             # NEW
.env.example                                           # MODIFIED — add AGENT_SECRET_KEY
```

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` lines 1351-1366] — Story 3.5 AC
- [Source: `_bmad-output/planning-artifacts/architecture.md`] — AgentSecret model spec
- [Source: `apps/api/prisma/schema.prisma`] — existing model patterns
- [Source: Node.js `crypto` module docs] — AES-256-GCM API

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Completion Notes List

- AES-256-GCM with `iv:ciphertext:authTag` (3-part format, not 2-part as AC10 states — GCM requires auth tag)
- CryptoModule registered as `@Global()` so all modules can inject CryptoService
- 22 crypto unit tests covering roundtrip, IV uniqueness, tampering, wrong key, missing/invalid env var

### File List

- `apps/api/prisma/schema.prisma` — MODIFIED (AgentSecret model + Agent relation)
- `apps/api/prisma/migrations/20260217200547_add_agent_secret_model/migration.sql` — NEW
- `apps/api/src/common/crypto/crypto.service.ts` — NEW
- `apps/api/src/common/crypto/crypto.module.ts` — NEW
- `apps/api/src/modules/app.module.ts` — MODIFIED (import CryptoModule)
- `apps/api/src/common/logger/agent.logger.ts` — MODIFIED (secret audit events)
- `apps/api/.env.example` — MODIFIED (AGENT_SECRET_KEY, DEFAULT_WEBHOOK_URL)
- `apps/api/test/common/crypto/crypto.service.spec.ts` — NEW
