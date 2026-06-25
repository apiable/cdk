/**
 * Live-integration run (`npm run test:live`). Selects only `*.live.spec.ts`, which need a
 * real AWS account and stay out of the default `npm test` / CI gate. Export RUN_LIVE_DEPLOY
 * (and AWS credentials) before running; without it the live scenarios are a documented no-op.
 */
const base = require('./jest.config')

module.exports = {
  ...base,
  testMatch: ['**/*.live.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
}
