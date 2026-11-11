/** @type {import('jest').Config} */
const base = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', diagnostics: true }] }
};

module.exports = {
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/main.ts'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'lcov'],
  // Metas da especificação (seção 15): 70% de linhas no geral e 100% nos fluxos críticos — auth, transição de status e portal.
  coverageThreshold: {
    global: { lines: 70, statements: 70 },
    './src/auth/guards.ts': { lines: 100 },
    './src/auth/token.service.ts': { lines: 100 },
    './src/service-orders/order-workflow.service.ts': { lines: 100 },
    './src/portal/portal.module.ts': { lines: 100 },
    './src/quotes/access-token.service.ts': { lines: 100 }
  },
  projects: [
    { ...base, displayName: 'unit', testMatch: ['<rootDir>/src/**/*.spec.ts'] },
    {
      ...base,
      displayName: 'integration',
      testMatch: ['<rootDir>/test/**/*.int-spec.ts'],
      globalSetup: '<rootDir>/test/global-setup.ts',
      setupFiles: ['<rootDir>/test/env.ts'],
      setupFilesAfterEnv: ['<rootDir>/test/after-env.ts']
    }
  ]
};
