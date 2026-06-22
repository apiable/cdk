/**
 * Default test run: synth-level specs only. The live-deploy spec is excluded by name.
 * `maxWorkers: 1` + ts-jest `isolatedModules` keep the verdict stable: the pure fixture→gate() specs
 * carry no shared state, so a parallel-worker heap-pressure flake is a runner artifact, never a gate
 * defect; a serial run with per-file transpilation (no type-checker heap per worker) is deterministic.
 */
module.exports = {
  testEnvironment: 'node',
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
    '^@apiable/cdk-usagelogs-stream$': '<rootDir>/lib/logs-stream/index.ts',
    '^@apiable/cdk-usagetokens-stream$': '<rootDir>/lib/logs-stream/index.ts',
    '^@apiable/parity-gate$': '<rootDir>/lib/parity-gate/index.ts',
    '^@apiable/umbrella$': '<rootDir>/lib/umbrella/index.ts',
    '^@apiable/cdk-ssm-composition$': '<rootDir>/lib/ssm-composition/index.ts',
    '^@apiable/cdk-console-explainer$': '<rootDir>/lib/console-explainer/index.ts',
  },
}
