import * as fs from 'fs';
import * as path from 'path';

/**
 * Jest setup file - runs before each test file.
 * Loads database connection info from temp file created by global setup.
 */

// Load database connection info for worker processes
const connectionFile = path.join(__dirname, '.db-connection.json');
if (fs.existsSync(connectionFile)) {
  const connectionInfo = JSON.parse(fs.readFileSync(connectionFile, 'utf-8'));
  process.env.DATABASE_HOST = connectionInfo.host;
  process.env.DATABASE_PORT = connectionInfo.port.toString();
  process.env.DATABASE_NAME = connectionInfo.database;
  process.env.DATABASE_USER = connectionInfo.username;
  process.env.DATABASE_PASSWORD = connectionInfo.password;
  process.env.DATABASE_URL = connectionInfo.connectionUri;
}

// Set test environment
process.env.NODE_ENV = 'test';

// Increase timeout for database operations
jest.setTimeout(30000);

// Global test utilities
beforeAll(async () => {
  // Add any global setup needed before all tests in a file
});

afterAll(async () => {
  // Add any global cleanup needed after all tests in a file
});

// Clean state between tests
beforeEach(() => {
  jest.clearAllMocks();
});
