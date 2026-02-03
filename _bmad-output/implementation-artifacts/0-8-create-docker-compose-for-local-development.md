# Story 0.8: Create Docker Compose for Local Development

Status: done

## Story

As a **developer**,
I want Docker Compose for local services,
So that I can run PostgreSQL and Redis locally without manual setup.

## Acceptance Criteria

1. **Given** the need for local development services
   **When** I create Docker Compose configuration
   **Then** `docker-compose.yml` defines PostgreSQL service

2. **And** Redis service is configured for caching and job queues

3. **And** Volumes persist data between restarts

4. **And** `docker-compose up -d` starts all services

5. **And** Services are accessible on standard ports

## Tasks / Subtasks

- [ ] Task 1: Create docker-compose.yml (AC: 1, 2)
  - [ ] Create `docker-compose.yml` at project root
  - [ ] Add PostgreSQL service (v16)
  - [ ] Add Redis service (v7)
  - [ ] Configure health checks

- [ ] Task 2: Configure volume persistence (AC: 3)
  - [ ] Create named volume for PostgreSQL data
  - [ ] Create named volume for Redis data
  - [ ] Add to .gitignore if using local volumes

- [ ] Task 3: Set up networking (AC: 5)
  - [ ] Configure PostgreSQL on port 5432
  - [ ] Configure Redis on port 6379
  - [ ] Create custom network for services

- [ ] Task 4: Add helper scripts
  - [ ] Add `docker:up` script to root package.json
  - [ ] Add `docker:down` script
  - [ ] Add `docker:logs` script
  - [ ] Add `docker:reset` script (removes volumes)

- [ ] Task 5: Verify services work (AC: 4)
  - [ ] Run `docker-compose up -d`
  - [ ] Verify PostgreSQL accepts connections
  - [ ] Verify Redis accepts connections
  - [ ] Test connection from API app

## Dev Notes

### Docker Compose Configuration

```yaml
# docker-compose.yml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: codeweaves-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: codeweaves
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: codeweaves-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    command: redis-server --appendonly yes

volumes:
  postgres_data:
  redis_data:

networks:
  default:
    name: codeweaves-network
```

### Package.json Scripts

```json
{
  "scripts": {
    "docker:up": "docker-compose up -d",
    "docker:down": "docker-compose down",
    "docker:logs": "docker-compose logs -f",
    "docker:reset": "docker-compose down -v && docker-compose up -d"
  }
}
```

### Environment Variables for Local Dev

```env
# .env.local (for local development)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/codeweaves"
REDIS_URL="redis://localhost:6379"
```

### Architecture Compliance

- **NFR36:** Database must use connection pooling (PgBouncer) - Note: Local dev uses direct connection
- **NFR38:** System must use Redis caching for sessions, config, and frequently accessed data

### Port Mapping

| Service | Container Port | Host Port |
|---------|---------------|-----------|
| PostgreSQL | 5432 | 5432 |
| Redis | 6379 | 6379 |

### Testing Commands

```bash
# Start services
docker-compose up -d

# Check status
docker-compose ps

# Check PostgreSQL
psql -h localhost -U postgres -d codeweaves

# Check Redis
redis-cli ping

# View logs
docker-compose logs -f

# Stop services
docker-compose down

# Reset (clear data)
docker-compose down -v
```

### Prerequisites

- Docker Desktop installed
- Docker Compose v2+ installed
- Ports 5432 and 6379 available

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#15-Infrastructure-DevOps]
- [Source: _bmad-output/planning-artifacts/epics.md#Story-0.8]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Completion Notes List

### File List

Files to create:
- `docker-compose.yml`
- `.env.local.example` (if not exists)

Files to modify:
- `package.json` (add docker scripts)
- `.gitignore` (ensure docker volumes ignored)
