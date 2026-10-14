import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests run against a real Postgres database. They wipe it, so never point this at real data.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://stagepass:stagepass@localhost:5432/stagepass_test',
      JWT_SECRET: 'test-secret',
    },
    fileParallelism: false,
  },
});
