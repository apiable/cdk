/** Default test run: synth-level specs only. The live-deploy spec is excluded by name. */
module.exports = {
  testEnvironment: 'node',
  // Serial + per-file transpilation: the pure fixture→gate() specs have no shared state, so a parallel
  // heap-pressure flake is a runner artifact; this keeps the suite verdict deterministic.
  maxWorkers: 1,
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { isolatedModules: true }],
    // The greenfield authorizer ships as an ESM .mjs asset; transform it so its real functions execute
    // in handler unit tests (no copied logic), rather than only asserting on its source text.
    '^.+\\.mjs$': ['ts-jest', { isolatedModules: true }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'mjs', 'json', 'node'],
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '\\.live\\.spec\\.ts$'],
  moduleNameMapper: {
    // The authorizer's only external dependency is the Cognito JWT verifier — an AWS boundary stubbed in
    // unit tests so the deny/allow + token-trust paths run against the real handler without a live pool.
    '^aws-jwt-verify$': '<rootDir>/test/support/aws-jwt-verify-mock.ts',
    '^@apiable/cdk-gateway-role$': '<rootDir>/lib/gateway-role/index.ts',
    '^@apiable/cdk-logs-bucket$': '<rootDir>/lib/logs-bucket/index.ts',
    '^@apiable/cdk-cognito-pool$': '<rootDir>/lib/cognito-pool/index.ts',
    '^@apiable/cdk-lambda-authorizer$': '<rootDir>/lib/lambda-authorizer/index.ts',
    '^@apiable/cdk-usagelogs-stream$': '<rootDir>/lib/logs-stream/index.ts',
    '^@apiable/cdk-usagetokens-stream$': '<rootDir>/lib/logs-stream/index.ts',
    '^@apiable/parity-gate$': '<rootDir>/lib/parity-gate/index.ts',
    '^@apiable/umbrella$': '<rootDir>/lib/umbrella/index.ts',
    '^@apiable/cdk-ssm-composition$': '<rootDir>/lib/ssm-composition/index.ts',
    '^@apiable/cdk-console-explainer$': '<rootDir>/lib/console-explainer/index.ts',
  },
}
