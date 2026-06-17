/**
 * Supplementary coverage for the parity gate beyond the frozen contract scenarios: reducer
 * edge/error paths, the authorizer and source-scoping rows the gateway-role pilot does not carry,
 * the extra-resource graph case, version precedence, logical normalisation, and the report
 * formatter. Every case drives the real reducers / gate, never a re-declaration of the diff logic.
 */
import {
  ChannelModel,
  formatGateReport,
  gate,
  normaliseLogical,
  reduceCloudFormation,
  reduceTerraformShowJson,
} from '@apiable/parity-gate'

const cfnAuthorizer = (type: string): unknown => ({
  Resources: {
    Authz: {
      Type: 'AWS::ApiGateway::Authorizer',
      Properties: { Name: 'authz', Type: type, IdentitySource: 'method.request.header.Authorization' },
    },
  },
})

const cfnInvokePermission = (scoped: boolean): unknown => ({
  Resources: {
    Invoke: {
      Type: 'AWS::Lambda::Permission',
      Properties: {
        Principal: 'cognito-idp.amazonaws.com',
        Action: 'lambda:InvokeFunction',
        FunctionName: 'pretokengen',
        ...(scoped ? { SourceArn: 'arn:aws:cognito-idp:eu-central-1:034444869755:userpool/authz' } : {}),
      },
    },
  },
})

const tfPoolBothForms = (): unknown => ({
  planned_values: {
    root_module: {
      resources: [
        {
          address: 'aws_cognito_user_pool.authz',
          type: 'aws_cognito_user_pool',
          values: {
            name: 'authz',
            user_pool_tier: 'ESSENTIALS',
            lambda_config: [
              {
                pre_token_generation: 'arn:aws:lambda:eu-central-1:034444869755:function:pretokengen',
                pre_token_generation_config: [{ lambda_version: 'V3_0', lambda_arn: 'arn:aws:lambda:eu-central-1:034444869755:function:pretokengen' }],
              },
            ],
          },
        },
      ],
    },
  },
  configuration: { root_module: { resources: [], outputs: {} } },
})

describe('parity gate — logical normalisation', () => {
  it('collapses account ids and AWS regions to logical tokens, leaving other text intact', () => {
    expect(normaliseLogical('arn:aws:iam::034444869755:root')).toBe('arn:aws:iam::{account}:root')
    expect(normaliseLogical('arn:aws:apigateway:eu-central-1::/*', 'eu-central-1')).toBe('arn:aws:apigateway:{region}::/*')
    expect(normaliseLogical('apiable-gateway-managment-role')).toBe('apiable-gateway-managment-role')
  })
})

describe('parity gate — reducer well-formedness and version precedence', () => {
  it('marks an artifact with no resources as not well-formed', () => {
    expect(reduceCloudFormation({ Resources: {} }, 'cfn').wellFormed).toBe(false)
    expect(reduceTerraformShowJson({ planned_values: { root_module: { resources: [] } } }, 'terraform').wellFormed).toBe(false)
  })

  it('prefers the explicit pre_token_generation_config version over the legacy attribute', () => {
    const model = reduceTerraformShowJson(tfPoolBothForms(), 'terraform', 'eu-central-1')
    expect(model.values['pretokengen-version:cognito-user-pool:authz']).toBe('V3_0')
  })
})

describe('parity gate — tiers beyond the role pilot', () => {
  it('fails on an authorizer-type divergence (a load-bearing value)', () => {
    const result = gate([
      reduceCloudFormation(cfnAuthorizer('TOKEN'), 'cdk'),
      reduceCloudFormation(cfnAuthorizer('TOKEN'), 'cfn'),
      reduceCloudFormation(cfnAuthorizer('REQUEST'), 'terraform'),
    ])
    expect(result.passed).toBe(false)
    const divergence = result.divergences.find((entry) => entry.tier === 'value' && entry.detail.includes('authorizer-type'))
    expect(divergence?.channels).toEqual(['terraform'])
  })

  it('fails when one channel leaves an invoke grant unscoped (source_arn) at equal resource count', () => {
    const result = gate([
      reduceCloudFormation(cfnInvokePermission(true), 'cdk'),
      reduceCloudFormation(cfnInvokePermission(true), 'cfn'),
      reduceCloudFormation(cfnInvokePermission(false), 'terraform'),
    ])
    expect(result.passed).toBe(false)
    const divergence = result.divergences.find((entry) => entry.tier === 'permission')
    expect(divergence?.detail).toContain('grant:invoke')
    expect(divergence?.channels).toEqual(['terraform'])
  })

  it('detects an EXTRA resource in one channel, not only a missing one', () => {
    const base: ChannelModel = reduceCloudFormation({ Resources: { R: { Type: 'AWS::IAM::Role', Properties: { RoleName: 'r' } } } }, 'cdk')
    const withExtra = reduceCloudFormation(
      {
        Resources: {
          R: { Type: 'AWS::IAM::Role', Properties: { RoleName: 'r' } },
          Extra: { Type: 'AWS::IAM::Role', Properties: { RoleName: 'extra' } },
        },
      },
      'terraform',
    )
    const result = gate([base, { ...base, channel: 'cfn' }, withExtra])
    expect(result.passed).toBe(false)
    const divergence = result.divergences.find((entry) => entry.tier === 'graph' && entry.detail.includes('iam-role:extra'))
    expect(divergence?.channels).toEqual(['terraform'])
  })
})

const cfnRole = (principal: unknown): unknown => ({
  Resources: {
    Role: {
      Type: 'AWS::IAM::Role',
      Properties: {
        RoleName: 'apiable-gateway-managment-role',
        AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: principal, Action: 'sts:AssumeRole' }] },
      },
    },
  },
})

// The trust-account value is keyed per role node, so a second role cannot clobber the first.
const TRUST_ACCOUNT_KEY = 'role-trust-account:iam-role:apiable-gateway-managment-role'

describe('parity gate — trust target (who may assume the role)', () => {
  it('captures the trusted account by value as a load-bearing setting, not a logical token', () => {
    const model = reduceCloudFormation(cfnRole({ AWS: 'arn:aws:iam::034444869755:root' }), 'cfn')
    expect(model.values[TRUST_ACCOUNT_KEY]).toBe('034444869755')
  })

  it('omits the trust-account setting when the role trusts a service principal, not an account', () => {
    const model = reduceCloudFormation(cfnRole({ Service: 'lambda.amazonaws.com' }), 'cfn')
    expect(model.values[TRUST_ACCOUNT_KEY]).toBeUndefined()
  })

  it('captures multiple trusted accounts by value, sorted so the key is channel-stable', () => {
    const model = reduceCloudFormation(cfnRole({ AWS: ['arn:aws:iam::222222222222:root', 'arn:aws:iam::111111111111:root'] }), 'cfn')
    expect(model.values[TRUST_ACCOUNT_KEY]).toBe('111111111111,222222222222')
  })

  it('reads an account named through a federated identity-provider trust by value', () => {
    const model = reduceCloudFormation(cfnRole({ Federated: 'arn:aws:iam::555555555555:saml-provider/corp' }), 'cfn')
    expect(model.values[TRUST_ACCOUNT_KEY]).toBe('555555555555')
  })
})

describe('parity gate — report', () => {
  it('renders a failing result naming the tier and the divergent detail', () => {
    const result = gate([
      reduceCloudFormation(cfnAuthorizer('TOKEN'), 'cdk'),
      reduceCloudFormation(cfnAuthorizer('TOKEN'), 'cfn'),
      reduceCloudFormation(cfnAuthorizer('REQUEST'), 'terraform'),
    ])
    const report = formatGateReport(result)
    expect(report).toContain('PARITY FAILED')
    expect(report).toContain('authorizer-type')
  })
})
