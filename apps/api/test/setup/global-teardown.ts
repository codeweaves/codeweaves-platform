import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import * as fs from 'fs';
import * as path from 'path';

declare global {
  var __POSTGRES_CONTAINER__: StartedPostgreSqlContainer | undefined;
}

/**
 * Global teardown for integration tests.
 * Stops and removes the PostgreSQL container.
 */
export default async function globalTeardown(): Promise<void> {
  console.log('\n🧹 Cleaning up PostgreSQL container...');

  // Remove temp connection file
  const tempFile = path.join(__dirname, '.db-connection.json');
  if (fs.existsSync(tempFile)) {
    fs.unlinkSync(tempFile);
  }

  // Stop the container
  if (global.__POSTGRES_CONTAINER__) {
    await global.__POSTGRES_CONTAINER__.stop();
    console.log('✅ PostgreSQL container stopped');
  }
}
