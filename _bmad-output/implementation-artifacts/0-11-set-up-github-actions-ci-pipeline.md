# Story 0.11: Set Up GitHub Actions CI Pipeline

Status: done

## Story

As a **developer**,
I want continuous integration via GitHub Actions,
So that code quality is verified on every pull request.

## Acceptance Criteria

1. **Given** the need for automated quality checks
   **When** I configure GitHub Actions
   **Then** `.github/workflows/ci.yml` defines the CI pipeline

2. **And** Pipeline runs: lint, typecheck, test, build

3. **And** Turborepo caching is utilized for faster builds

4. **And** PR checks block merge on failure

5. **And** Pipeline completes in under 10 minutes

## Tasks / Subtasks

- [ ] Task 1: Create CI workflow file (AC: 1)
  - [ ] Create `.github/workflows/ci.yml`
  - [ ] Set up trigger on pull requests
  - [ ] Set up trigger on push to main

- [ ] Task 2: Configure job steps (AC: 2)
  - [ ] Install pnpm with caching
  - [ ] Install dependencies
  - [ ] Run lint step
  - [ ] Run typecheck step
  - [ ] Run test step with coverage
  - [ ] Run build step

- [ ] Task 3: Set up Turborepo caching (AC: 3)
  - [ ] Configure remote caching (optional)
  - [ ] Set up local cache restoration
  - [ ] Verify cache hits in subsequent runs

- [ ] Task 4: Configure branch protection (AC: 4)
  - [ ] Document required status checks
  - [ ] Note: Manual setup in GitHub repo settings

- [ ] Task 5: Optimize for speed (AC: 5)
  - [ ] Use parallel jobs where possible
  - [ ] Minimize redundant work
  - [ ] Test pipeline runs under 10 minutes

## Dev Notes

### CI Workflow

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

env:
  TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
  TURBO_TEAM: ${{ vars.TURBO_TEAM }}

jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v3
        with:
          version: 9

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run lint
        run: pnpm lint

  typecheck:
    name: Type Check
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v3
        with:
          version: 9

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run type check
        run: pnpm check-types

  test:
    name: Test
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v3
        with:
          version: 9

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run tests
        run: pnpm test:cov
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/test
          REDIS_URL: redis://localhost:6379

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          token: ${{ secrets.CODECOV_TOKEN }}
          files: ./coverage/lcov.info
          fail_ci_if_error: false

  build:
    name: Build
    runs-on: ubuntu-latest
    needs: [lint, typecheck]
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v3
        with:
          version: 9

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build all packages
        run: pnpm build

      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: build-artifacts
          path: |
            apps/*/dist
            apps/*/.next
          retention-days: 7
```

### Branch Protection Rules (Manual Setup)

Configure in GitHub repo Settings > Branches > Branch protection rules:

- **Branch name pattern:** `main`
- **Require status checks:**
  - `lint`
  - `typecheck`
  - `test`
  - `build`
- **Require branches to be up to date**
- **Require pull request reviews:** 1 approval

### Architecture Compliance

- **NFR71:** Automated tests must run in CI/CD pipeline and block merge on failure
- **Quality Gates (PR Merge):**
  - Unit tests pass: 100%
  - Integration tests pass: 100%
  - Code coverage: >80%
  - Linting: 0 errors
  - Type checking: 0 errors

### Secrets Required

| Secret | Purpose |
|--------|---------|
| `TURBO_TOKEN` | Remote caching (optional) |
| `CODECOV_TOKEN` | Coverage reporting (optional) |

### Pipeline Structure

```
┌─────────────────────────────────────────────┐
│               CI Pipeline                    │
├─────────────────────────────────────────────┤
│                                             │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐ │
│  │   lint   │  │ typecheck │  │   test   │ │
│  └────┬─────┘  └─────┬─────┘  └────┬─────┘ │
│       │              │              │       │
│       └──────────────┼──────────────┘       │
│                      │                      │
│                      ▼                      │
│               ┌──────────┐                  │
│               │  build   │                  │
│               └──────────┘                  │
│                                             │
└─────────────────────────────────────────────┘
```

### Testing Requirements

- CI should pass on clean codebase
- All jobs should complete < 10 minutes total
- Caching should show hits on subsequent runs

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#15-Infrastructure-DevOps]
- [Source: _bmad-output/planning-artifacts/epics.md#Story-0.11]
- [GitHub Actions: https://docs.github.com/en/actions]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Completion Notes List

### File List

Files to create:
- `.github/workflows/ci.yml`

Files to verify:
- `turbo.json` (task definitions)
- `package.json` (script names)
