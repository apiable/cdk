/**
 * Jest transformer that compiles the greenfield authorizer's ESM `.mjs` asset to CommonJS, so the REAL
 * handler executes inside this CommonJS test runner (no copied logic). TypeScript forces ESM emit for a
 * `.mjs` *fileName* regardless of the `module` compiler option, so ts-jest cannot down-level the asset and
 * a CommonJS spec that imports it crashes on the surviving `import` statement. Presenting the same source
 * under a normalized non-`.mjs` fileName makes `transpileModule` honour `module: CommonJS`; the asset on
 * disk is never touched. Scoped to `^.+\.mjs$` in jest.config.js, which only the authorizer handler specs
 * import — every other suite is unaffected.
 */
const crypto = require('crypto')
const ts = require('typescript')

const COMPILER_OPTIONS = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2020,
  esModuleInterop: true,
}

module.exports = {
  process(sourceText, sourcePath) {
    const { outputText } = ts.transpileModule(sourceText, {
      compilerOptions: COMPILER_OPTIONS,
      fileName: sourcePath.replace(/\.mjs$/, '.ts'),
    })
    return { code: outputText }
  },
  getCacheKey(sourceText, sourcePath) {
    return crypto
      .createHash('sha1')
      .update('mjs-commonjs-transformer-v1\0')
      .update(sourcePath)
      .update('\0')
      .update(sourceText)
      .digest('hex')
  },
}
