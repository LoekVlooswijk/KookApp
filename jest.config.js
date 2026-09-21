/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      displayName: 'app',
      preset: 'jest-expo',
      testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
      testPathIgnorePatterns: ['<rootDir>/lib/__tests__/dbMigrations.test.ts'],
      moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
      collectCoverageFrom: ['lib/**/*.{ts,tsx}', '!lib/**/*.d.ts'],
    },
    {
      displayName: 'migrations',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/lib/__tests__/dbMigrations.test.ts'],
      transform: {
        '^.+\\.tsx?$': ['babel-jest', { configFile: './babel.config.js' }],
      },
      transformIgnorePatterns: ['/node_modules/'],
      moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
    },
  ],
};
