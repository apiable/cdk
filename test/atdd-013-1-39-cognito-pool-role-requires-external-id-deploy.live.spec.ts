/**
 * Live check (scenario S1) for the user pool role: deployed for real from the published one-click stack, it
 * can be taken up from Apiable's account only with the API Portal's own ID and, from Apiable's address,
 * performs the five operations on that pool.
 *
 * It needs a real AWS account and a real user pool, so it is excluded from the default `npm test` and CI by
 * the `.live.spec.ts` name (see jest.config.js) and is run by a person, through `npm run test:live`.
 *
 * Manual hand-off: an operator with a sandbox account and a user pool in it runs
 *   APIABLE_EXTERNAL_ID=<the sandbox API Portal's ID> USER_POOL_ID=<the pool id> AWS_REGION=<the pool's Region> npm run test:live
 * then follows the printed link and checks, in this order:
 *   1. the stack asks for the External ID and the user pool id, and refuses an ID that is not one lowercase
 *      version 4 UUID and a pool id that is not one user pool id;
 *   2. creation succeeds and the role is named apiable-cognito-pool-role-<pool id>;
 *   3. from Apiable's account and address, taking up the role with no ID and with another portal's ID is
 *      refused, and with the sandbox portal's ID it is admitted;
 *   4. with the role taken up, the five operations on that pool succeed, and listing the pool's app clients
 *      or reading the pool itself is refused;
 *   5. the stack is deleted afterwards.
 * Without both values this spec is a documented no-op; it asserts nothing about AWS and never stands in for
 * the operator's check.
 */
import { DEFAULT_APIABLE_EGRESS_CIDR, DEFAULT_APIABLE_TRUST_ACCOUNT, DEFAULT_LAUNCHSTACK_BUCKET } from '@apiable/cdk-gateway-role'
import { CONSTRUCT_NAME, regionOfUserPoolId, USER_POOL_ID_PATTERN } from '@apiable/cdk-cognito-pool-role'
import { publishedVersion } from './support/published-template'

describe('user pool role: live deploy', () => {
  // contract: S1
  it('S1: the role deployed from the published one-click stack works for its own API Portal only', () => {
    const externalId = process.env.APIABLE_EXTERNAL_ID
    const userPoolId = process.env.USER_POOL_ID
    if (externalId === undefined || userPoolId === undefined) {
      // eslint-disable-next-line no-console
      console.log('manual hand-off: set APIABLE_EXTERNAL_ID and USER_POOL_ID for the sandbox API Portal and pool, then run again')
      return
    }
    expect(userPoolId).toMatch(USER_POOL_ID_PATTERN)
    const region = process.env.AWS_REGION ?? regionOfUserPoolId(userPoolId)
    const version = process.env.LAUNCHSTACK_VERSION ?? publishedVersion(CONSTRUCT_NAME)
    const params = new URLSearchParams({
      templateURL: `https://${DEFAULT_LAUNCHSTACK_BUCKET}.s3.amazonaws.com/${CONSTRUCT_NAME}/${version}/template.yaml`,
      stackName: `${CONSTRUCT_NAME}-${userPoolId.replace('_', '-')}`,
      param_ApiableTrustAccount: DEFAULT_APIABLE_TRUST_ACCOUNT,
      param_ApiableExternalId: externalId,
      param_UserPoolId: userPoolId,
      param_ApiableEgressCidr: DEFAULT_APIABLE_EGRESS_CIDR,
    })
    // eslint-disable-next-line no-console
    console.log(
      `[S1 manual hand-off] open https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks/create/review?${params.toString()} ` +
        'and work through the five checks in the header of this spec',
    )
  })
})
