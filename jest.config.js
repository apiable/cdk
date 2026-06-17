/** Default test run: synth-level specs only. The live-deploy spec is excluded by name. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '\\.live\\.spec\\.ts$'],
  moduleNameMapper: {
    '^@apiable/cdk-gateway-role$': '<rootDir>/lib/gateway-role/index.ts',
    '^@apiable/cdk-logs-bucket$': '<rootDir>/lib/logs-bucket/index.ts',
    '^@apiable/parity-gate$': '<rootDir>/lib/parity-gate/index.ts',
    '^@apiable/umbrella$': '<rootDir>/lib/umbrella/index.ts',
    '^@apiable/cdk-ssm-composition$': '<rootDir>/lib/ssm-composition/index.ts',
    '^@apiable/cdk-console-explainer$': '<rootDir>/lib/console-explainer/index.ts',
  },
}
