/** Default test run: synth-level specs only. The live-deploy spec is excluded by name. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '\\.live\\.spec\\.ts$'],
  moduleNameMapper: {
    '^@apiable/cdk-gateway-role$': '<rootDir>/lib/gateway-role/index.ts',
    '^@apiable/parity-gate$': '<rootDir>/lib/parity-gate/index.ts',
  },
}
