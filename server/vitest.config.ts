import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    // Tests share one MongoDB database, so they must not run in parallel.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Set here rather than in setup.ts: ES module imports are hoisted, so anything
    // assigned in the setup file body would run after the modules under test had
    // already read process.env.
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      LOG_PRETTY: 'false',
      MONGODB_URI: process.env['TEST_MONGODB_URI'] ?? 'mongodb://127.0.0.1:27017',
      MONGODB_DB_NAME: process.env['TEST_MONGODB_DB'] ?? 'speaking_coach_test',
      JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-0123456789',
      JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-9876543210',
      BYOK_ENABLED: 'true',
      BYOK_ENCRYPTION_KEY: '4f1f8b2c6d3e9a071b5c4d2e8f0a1b3c5d7e9f0a1b2c3d4e5f60718293a4b5c6',
      RATE_LIMIT_AUTH_PER_15_MIN: '1000',
      RATE_LIMIT_API_PER_MIN: '5000',
    },
  },
});
