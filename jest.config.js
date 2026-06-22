/** Default test run: synth-level specs only. The live-deploy spec is excluded by name. */
module.exports = {
  testEnvironment: 'node',
  // Serial + per-file transpilation: the pure fixture→gate() specs have no shared state, so a parallel
  // heap-pressure flake is a runner artifact; this keeps the suite verdict deterministic.
  maxWorkers: 1,
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { isolatedModules: true }],
  },
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '\\.live\\.spec\\.ts$'],
  moduleNameMapper: {
    '^@apiable/cdk-gateway-role$': '<rootDir>/lib/gateway-role/index.ts',
    '^@apiable/cdk-logs-bucket$': '<rootDir>/lib/logs-bucket/index.ts',
    '^@apiable/cdk-cognito-pool$': '<rootDir>/lib/cognito-pool/index.ts',
    '^@apiable/cdk-usagelogs-stream$': '<rootDir>/lib/logs-stream/index.ts',
    '^@apiable/cdk-usagetokens-stream$': '<rootDir>/lib/logs-stream/index.ts',
    '^@apiable/parity-gate$': '<rootDir>/lib/parity-gate/index.ts',
    '^@apiable/umbrella$': '<rootDir>/lib/umbrella/index.ts',
    '^@apiable/cdk-ssm-composition$': '<rootDir>/lib/ssm-composition/index.ts',
    '^@apiable/cdk-console-explainer$': '<rootDir>/lib/console-explainer/index.ts',
  },
}
