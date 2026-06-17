/**
 * Edge / quality coverage for the apiable-gateway-role Terraform module, beyond the frozen
 * contract scenarios in the parity spec: provider/version pinning, reusable-module hygiene
 * (no provider/backend block), IAM policy-document version, and the leading-zero trust default.
 * Exercises the real module source (no copied policy logic).
 */
import * as fs from 'fs'
import * as path from 'path'
import { DEFAULT_APIABLE_TRUST_ACCOUNT } from '@apiable/cdk-gateway-role'

const MODULE_DIR = path.resolve(__dirname, '../terraform/apiable-gateway-role')
const moduleFile = (name: string): string => fs.readFileSync(path.join(MODULE_DIR, name), 'utf8')

describe('apiable-gateway-role terraform module — provider + version pinning', () => {
  it('pins the AWS provider to hashicorp/aws ~> 5.0 and a minimum terraform version', () => {
    const versions = moduleFile('versions.tf')
    expect(versions).toMatch(/required_version\s*=\s*">=\s*1\.8\.0"/)
    expect(versions).toMatch(/source\s*=\s*"hashicorp\/aws"/)
    expect(versions).toMatch(/version\s*=\s*"~>\s*5\.0"/)
  })
})

describe('apiable-gateway-role terraform module — reusable-module hygiene', () => {
  it('declares no provider or backend block (the consuming root configures those)', () => {
    const all = fs
      .readdirSync(MODULE_DIR)
      .filter((f) => f.endsWith('.tf'))
      .map(moduleFile)
      .join('\n')
    expect(all).not.toMatch(/provider\s+"aws"\s*\{/)
    expect(all).not.toMatch(/backend\s+"/)
  })

  it('exposes exactly one output — the role ARN', () => {
    const outputs = moduleFile('outputs.tf')
    expect(outputs.match(/output\s+"/g)).toHaveLength(1)
    expect(outputs).toMatch(/output\s+"role_arn"[\s\S]*value\s*=\s*aws_iam_role\.this\.arn/)
  })
})

describe('apiable-gateway-role terraform module — IAM document + trust default', () => {
  it('stamps both IAM documents with the 2012-10-17 policy version', () => {
    const main = moduleFile('main.tf')
    expect(main.match(/Version\s*=\s*"2012-10-17"/g)).toHaveLength(2)
  })

  it('keeps the default trust account a 12-character string, preserving its leading zero', () => {
    const def = moduleFile('variables.tf').match(/default\s*=\s*"([^"]+)"/)?.[1]
    expect(def).toBe(DEFAULT_APIABLE_TRUST_ACCOUNT)
    expect(def).toHaveLength(12)
    expect(def?.startsWith('0')).toBe(true)
  })

  it('gives the no-widen validation a non-empty error message', () => {
    const vars = moduleFile('variables.tf')
    const msg = vars.match(/error_message\s*=\s*"([^"]+)"/)?.[1]
    expect(msg && msg.length).toBeGreaterThan(0)
  })
})
