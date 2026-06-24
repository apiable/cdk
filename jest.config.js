/** Default test run: synth-level specs only. The live-deploy spec is excluded by name. */
module.exports = {
  testEnvironment: 'node',
  // Serial + per-file transpilation: the pure fixture→gate() specs have no shared state, so a parallel
  // heap-pressure flake is a runner artifact; this keeps the suite verdict deterministic.
  maxWorkers: 1,
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { isolatedModules: true }],
    // The greenfield authorizer ships as an ESM .mjs asset. ts-jest cannot down-level it (TypeScript forces
    // ESM emit by the .mjs extension), so a dedicated transformer compiles it to CommonJS — the real handler
    // functions then execute in the handler unit tests rather than only being asserted against as source text.
    '^.+\\.mjs$': '<rootDir>/test/support/mjs-commonjs-transformer.cjs',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'mjs', 'json', 'node'],
  // Seeds the authorizer's runtime env before its handler module is imported (cold-start parse), so the
  // handler unit tests can exercise the allow path against a known required-scope map. Harmless to the
  // other suites, which read neither env var.
  setupFiles: ['<rootDir>/test/support/authorizer-env.ts'],
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
