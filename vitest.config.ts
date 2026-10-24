import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'mysql://root@127.0.0.1:3306/ledford_bills_test',
      LEGACY_TEST_DATABASE_URL: process.env.LEGACY_TEST_DATABASE_URL ?? 'mysql://root@127.0.0.1:3306/ledford_bills_legacy_fixture',
      MAIL_TRANSPORT: 'memory',
      APP_URL: 'http://localhost:3000'
    }
  }
})
