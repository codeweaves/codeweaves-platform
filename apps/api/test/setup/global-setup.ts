import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

declare global {
  // eslint-disable-next-line no-var
  var __POSTGRES_CONTAINER__: StartedPostgreSqlContainer | undefined;
}

/**
 * Global setup for integration tests.
 * Starts a PostgreSQL container that persists across all test files.
 *
 * Environment variables set:
 * - DATABASE_HOST
 * - DATABASE_PORT
 * - DATABASE_NAME
 * - DATABASE_USER
 * - DATABASE_PASSWORD
 * - DATABASE_URL
 */
export default async function globalSetup(): Promise<void> {
  console.log('\n🐘 Starting PostgreSQL container for integration tests...');

  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('codeweaves_test')
    .withUsername('test_user')
    .withPassword('test_password')
    .withExposedPorts(5432)
    .start();

  // Store container reference for teardown
  global.__POSTGRES_CONTAINER__ = container;

  // Set environment variables for tests
  process.env.DATABASE_HOST = container.getHost();
  process.env.DATABASE_PORT = container.getMappedPort(5432).toString();
  process.env.DATABASE_NAME = container.getDatabase();
  process.env.DATABASE_USER = container.getUsername();
  process.env.DATABASE_PASSWORD = container.getPassword();
  process.env.DATABASE_URL = container.getConnectionUri();

  // Write connection info to temp file for worker processes
  const connectionInfo = {
    host: container.getHost(),
    port: container.getMappedPort(5432),
    database: container.getDatabase(),
    username: container.getUsername(),
    password: container.getPassword(),
    connectionUri: container.getConnectionUri(),
  };

  const fs = await import('fs');
  const path = await import('path');
  const tempFile = path.join(__dirname, '.db-connection.json');
  fs.writeFileSync(tempFile, JSON.stringify(connectionInfo));

  console.log(`✅ PostgreSQL container started at ${container.getConnectionUri()}`);
}
