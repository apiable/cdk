/**
 * API Gateway caches an authorizer's policy per token and reuses it for every route of the API, so the
 * policy the handler returns must be right for every route, not only the one called. These specs run the
 * real handler (only token verification is stubbed) and judge each returned policy the way the gateway
 * does, with a judge written here that shares nothing with the handler's own matching.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as ts from 'typescript'
import type { AuthResponse } from '../lib/assets/lambdas/authorization-cc/index.mjs'
import { parseHcl } from './support/hcl'

type HandlerModule = typeof import('../lib/assets/lambdas/authorization-cc/index.mjs')
type VerifierStub = typeof import('./support/aws-jwt-verify-mock')
type Claims = Record<string, string>

const REPO_ROOT = path.resolve(__dirname, '..')
const HANDLER_SOURCE = path.join(REPO_ROOT, 'lib/assets/lambdas/authorization-cc/index.mjs')

const REGION = 'eu-west-1'
const ACCOUNT = '111122223333'
const API = 'abc'
const STAGE = 'prod'

/** The gateway's address for a `<METHOD> <path>` route on one API and stage. */
const address = (route: string, api = API, stage = STAGE): string => {
  const space = route.indexOf(' ')
  return `arn:aws:execute-api:${REGION}:${ACCOUNT}:${api}/${stage}/${route.slice(0, space)}${route.slice(space + 1)}`
}
const STAGE_PREFIX = `arn:aws:execute-api:${REGION}:${ACCOUNT}:${API}/${STAGE}/`

// ── the judge: API Gateway's reading of a returned policy ──

const resourceMatches = (pattern: string, value: string): boolean => {
  let source = '^'
  for (const ch of pattern) {
    if (ch === '*') source += '[\\s\\S]*'
    else if (ch === '?') source += '[\\s\\S]'
    else source += ch.replace(/[\\^$.|+()[\]{}]/g, '\\$&')
  }
  return new RegExp(`${source}$`).test(value)
}

const resourcesOf = (resource: string | string[]): string[] => (Array.isArray(resource) ? resource : [resource])

/** An explicit Deny that matches wins; otherwise an Allow whose resource matches allows; otherwise refused. */
const allows = (policy: AuthResponse, target: string): boolean => {
  const statements = policy.policyDocument.Statement
  const named = (effect: string) =>
    statements.some((s) => s.Effect === effect && resourcesOf(s.Resource).some((r) => resourceMatches(r, target)))
  return !named('Deny') && named('Allow')
}

const allowedResources = (policy: AuthResponse): string[] =>
  policy.policyDocument.Statement.filter((s) => s.Effect === 'Allow').flatMap((s) => resourcesOf(s.Resource))

const DENY_ALL_LITERAL = {
  principalId: 'user',
  policyDocument: {
    Version: '2012-10-17',
    Statement: [{ Action: 'execute-api:Invoke', Effect: 'Deny', Resource: '*' }],
  },
}

// ── the real handler, loaded with a case's scope map ──

interface Loaded {
  mod: HandlerModule
  call: (claims: Claims, route: string) => Promise<AuthResponse>
  callArn: (claims: Claims, methodArn: string) => Promise<AuthResponse>
}

/**
 * The handler reads REQUIRED_SCOPE_MAP once at module load, so each case loads its own copy. The verifier
 * stub is required in the same isolated registry: one required outside it would be a different instance
 * from the handler's, and every call would be denied for the wrong reason.
 */
const load = (map: Record<string, string> | string): Loaded => {
  const saved = process.env.REQUIRED_SCOPE_MAP
  process.env.REQUIRED_SCOPE_MAP = typeof map === 'string' ? map : JSON.stringify(map)
  let mod: HandlerModule | undefined
  let stub: VerifierStub | undefined
  try {
    jest.isolateModules(() => {
      mod = require('../lib/assets/lambdas/authorization-cc/index.mjs') as HandlerModule
      stub = require('./support/aws-jwt-verify-mock') as VerifierStub
    })
  } finally {
    process.env.REQUIRED_SCOPE_MAP = saved
  }
  if (!mod || !stub) throw new Error('the handler did not load')
  const handlerModule = mod
  const verifier = stub
  const callArn = (claims: Claims, methodArn: string) => {
    verifier.__setVerifyResult(claims)
    return handlerModule.handler({ authorizationToken: `Bearer ${TOKEN}`, methodArn })
  }
  return { mod: handlerModule, callArn, call: (claims, route) => callArn(claims, address(route)) }
}

// Obviously-fake sentinels (not credentials): the specs assert they never reach a log line.
const TOKEN = 'tok-sentinel-7f3a'
const API_KEY = 'apikey-sentinel-91c2'
const EXTRA = 'extra-claim-sentinel-55d0'
const claims = (scope: string, plan = '', extra: Claims = {}): Claims => ({
  client_id: 'client-1',
  sub: 'sub-1',
  scope,
  apiable_api_key: API_KEY,
  ...(plan ? { apiable_plan_resources: plan } : {}),
  ...extra,
})

let logs: string[] = []
beforeEach(() => {
  logs = []
  jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '))
  })
})
afterEach(() => jest.restoreAllMocks())

/** Every returned allow names only wildcard-free addresses on the called API and stage that read back to their route. */
const expectWellFormed = (loaded: Loaded, policy: AuthResponse): void => {
  for (const resource of allowedResources(policy)) {
    expect(resource).not.toMatch(/[*?]/)
    expect(resource.startsWith(STAGE_PREFIX)).toBe(true)
    expect(address(loaded.mod.routeKeyFromMethodArn(resource))).toBe(resource)
  }
}

const expectUntouchedDenyAll = (loaded: Loaded): void => {
  expect(loaded.mod.defaultDenyAllPolicy).toStrictEqual(DENY_ALL_LITERAL)
  expect('usageIdentifierKey' in loaded.mod.defaultDenyAllPolicy).toBe(false)
}

const AB_MAP = { 'GET /a': 'apiable/a', 'DELETE /b': 'apiable/b' }

describe('the judge', () => {
  // contract: 024-7-4 S14
  it('reads a wildcard resource as matching any route and a literal resource as matching only itself', () => {
    const policy = (resource: string): AuthResponse => ({
      principalId: 'p',
      policyDocument: { Version: '2012-10-17', Statement: [{ Action: 'execute-api:Invoke', Effect: 'Allow', Resource: resource }] },
    })
    expect(allows(policy(`${STAGE_PREFIX}*`), address('GET /a'))).toBe(true)
    expect(allows(policy(address('GET /a')), address('DELETE /b'))).toBe(false)
    expect(allows(policy(`${STAGE_PREFIX}GET/?`), address('GET /a'))).toBe(true)
    expect(allows(DENY_ALL_LITERAL as AuthResponse, address('GET /a'))).toBe(false)
  })
})

describe('a cached result never allows a route the scope check did not approve', () => {
  // contract: 024-7-4 S1
  // contract: 024-7-4 S14
  it('F1: a token allowed on GET /a gets a policy that does not allow DELETE /b, which its scopes do not satisfy', async () => {
    const h = load(AB_MAP)
    const policy = await h.call(claims('apiable/a'), 'GET /a')

    expect(allows(policy, address('GET /a'))).toBe(true)
    expect(allows(policy, address('DELETE /b'))).toBe(false)
    expectWellFormed(h, policy)
  })

  // contract: 024-7-4 S2
  // contract: 024-7-4 S8
  it('F2: a token whose scopes satisfy both routes gets, from either call, a policy allowing both, with its sub and api key', async () => {
    const h = load(AB_MAP)
    for (const route of ['GET /a', 'DELETE /b']) {
      const policy = await h.call(claims('apiable/a apiable/b'), route)
      expect(allows(policy, address(route))).toBe(true)
      expect(allows(policy, address('GET /a'))).toBe(true)
      expect(allows(policy, address('DELETE /b'))).toBe(true)
      expect(policy.principalId).toBe('sub-1')
      expect(policy.usageIdentifierKey).toBe(API_KEY)
      expectWellFormed(h, policy)
    }
  })

  // contract: 024-7-4 S3
  it('F3: plan resources narrow the policy; a plan reaching the whole stage leaves exactly the scope-satisfied routes', async () => {
    const h = load(AB_MAP)
    const both = 'apiable/a apiable/b'

    const narrowed = await h.call(claims(both, `${API}/${STAGE}/GET/a`), 'GET /a')
    expect(allows(narrowed, address('GET /a'))).toBe(true)
    expect(allows(narrowed, address('DELETE /b'))).toBe(false)
    expectWellFormed(h, narrowed)

    const fenced = await h.call(claims(both, `${API}/${STAGE}/GET/a`), 'DELETE /b')
    expect(allows(fenced, address('DELETE /b'))).toBe(false)
    expectWellFormed(h, fenced)

    const proxy = await h.call(claims(both, `${API}/${STAGE}/ANY/{proxy+}`), 'GET /a')
    expect(allowedResources(proxy).sort()).toEqual([address('DELETE /b'), address('GET /a')].sort())
    const noPlan = await h.call(claims(both), 'GET /a')
    expect(allowedResources(proxy).sort()).toEqual(allowedResources(noPlan).sort())
  })

  // contract: 024-7-4 S9
  it('names only addresses on the called API and stage, even when the plan names other APIs and stages', async () => {
    const h = load(AB_MAP)
    const plan = [
      `${API}/${STAGE}/GET/a`,
      `other-api/${STAGE}/DELETE/b`,
      `${API}/staging/DELETE/b`,
      `other-api/${STAGE}/ANY/{proxy+}`,
    ].join(';')
    const policy = await h.call(claims('apiable/a apiable/b', plan), 'GET /a')

    expect(allowedResources(policy)).toEqual([address('GET /a')])
    for (const resource of allowedResources(policy)) {
      expect(resource.startsWith(STAGE_PREFIX)).toBe(true)
      expect(resource).not.toBe(`${STAGE_PREFIX}*`)
    }
    expect(allows(policy, address('DELETE /b', 'other-api'))).toBe(false)
    expect(allows(policy, address('DELETE /b', API, 'staging'))).toBe(false)
  })
})

describe('over every scope set, plan and pair of calls, a cached result agrees with a fresh check', () => {
  const GRID_MAP = { 'GET /a': 'apiable/a', 'DELETE /b': 'apiable/b', 'POST /e': '' }
  const ROUTES = ['GET /a', 'DELETE /b', 'PUT /a', 'POST /e']
  const SCOPE_SETS: string[][] = [[], ['apiable/a'], ['apiable/b'], ['apiable/a', 'apiable/b']]
  const PLANS: { name: string; claim: string; reaches: (route: string) => boolean }[] = [
    { name: 'no plan', claim: '', reaches: () => true },
    { name: 'GET /a only', claim: `${API}/${STAGE}/GET/a`, reaches: (route) => route === 'GET /a' },
    { name: 'ANY {proxy+}', claim: `${API}/${STAGE}/ANY/{proxy+}`, reaches: () => true },
  ]

  /** Today's rule, stated on its own: a non-empty map value whose scopes the token all holds, and a plan that reaches the route. */
  const todayAllows = (scopes: string[], plan: (typeof PLANS)[number], route: string): boolean => {
    const required = (GRID_MAP as Record<string, string>)[route]
    return !!required && required.split(' ').every((s) => scopes.includes(s)) && plan.reaches(route)
  }

  const cases = SCOPE_SETS.flatMap((scopes) => PLANS.map((plan) => [scopes.join(' ') || 'no scope', plan.name, scopes, plan] as const))

  // contract: 024-7-4 S4
  // contract: 024-7-4 S8
  it.each(cases)('F4: scopes %s, plan %s', async (_s, _p, scopes, plan) => {
    const h = load(GRID_MAP)
    const token = claims(scopes.join(' '), plan.claim)
    const fresh = new Map<string, boolean>()
    for (const route of ROUTES) {
      const policy = await h.call(token, route)
      fresh.set(route, allows(policy, address(route)))
      expect(fresh.get(route)).toBe(todayAllows(scopes, plan, route))
    }

    for (const first of ROUTES) {
      const policy = await h.call(token, first)
      expectWellFormed(h, policy)
      const scopePassed = !!(GRID_MAP as Record<string, string>)[first] &&
        (GRID_MAP as Record<string, string>)[first].split(' ').every((s) => scopes.includes(s))
      if (!scopePassed) {
        expect(policy).toBe(h.mod.defaultDenyAllPolicy)
      }
      for (const second of ROUTES) {
        const cachedAllows = allows(policy, address(second))
        if (cachedAllows) expect(fresh.get(second)).toBe(true)
        if (fresh.get(first) && fresh.get(second)) expect(cachedAllows).toBe(true)
      }
    }
    expectUntouchedDenyAll(h)
  })
})

describe('only a route that can be named exactly is named', () => {
  const LONG_ROUTE = `GET /${'x'.repeat(520)}`
  const NAMEABLE = [
    'GET /v1/file.json',
    'GET /a-b',
    'GET /a~b',
    'GET /trail/',
    'PATCH /p',
    'OPTIONS /o',
    'GET /',
    'GET /pets/{id}',
  ]
  const NOT_NAMEABLE = ['GET /c:d', 'GET /s*', 'GET /q?', LONG_ROUTE]
  const KEY_MAP: Record<string, string> = Object.fromEntries(
    [...NAMEABLE, ...NOT_NAMEABLE, 'badkey', 'GET nopath', 'GET  /double-space'].map((key) => [key, 'apiable/k']),
  )

  // contract: 024-7-4 S5
  it('F6: names routes with . - ~ a trailing / PATCH OPTIONS, the root and a template literally; never : * ? a bad shape or an overlong address', async () => {
    const h = load(KEY_MAP)
    const policy = await h.call(claims('apiable/k'), 'GET /a-b')

    expect(allowedResources(policy).sort()).toEqual(NAMEABLE.map((route) => address(route)).sort())
    expect(allowedResources(policy)).toContain(`${STAGE_PREFIX}GET/`)
    expect(allowedResources(policy)).toContain(`${STAGE_PREFIX}GET/pets/{id}`)
    expect(allowedResources(policy).some((r) => r.endsWith('/GET//'))).toBe(false)
    expectWellFormed(h, policy)

    for (const route of NAMEABLE) {
      const fresh = await h.call(claims('apiable/k'), route)
      expect(allows(fresh, address(route))).toBe(true)
      expect(h.mod.routeKeyFromMethodArn(address(route))).toBe(route)
    }
    for (const route of NOT_NAMEABLE) {
      const fresh = await h.call(claims('apiable/k'), route)
      expect(allows(fresh, address(route))).toBe(false)
      expectWellFormed(h, fresh)
    }
    expectUntouchedDenyAll(h)
  })

  // contract: 024-7-4 S5
  it('refuses a call to an overlong route whose map holds nothing else', async () => {
    const h = load({ [LONG_ROUTE]: 'apiable/k' })
    const policy = await h.call(claims('apiable/k'), LONG_ROUTE)
    expect(policy).toBe(h.mod.defaultDenyAllPolicy)
    expectUntouchedDenyAll(h)
  })
})

describe('a policy over the size bound falls back to the called route alone', () => {
  const bigRoute = (i: number): string => `GET /r/${String(i).padStart(3, '0')}-${'segment'.repeat(10)}`
  const BIG_ROUTES = Array.from({ length: 60 }, (_, i) => bigRoute(i))
  const OUTSIDE = `GET /other/${'segment'.repeat(10)}`
  const BIG_MAP: Record<string, string> = Object.fromEntries(
    [...BIG_ROUTES, OUTSIDE, 'GET /star*', `GET /${'y'.repeat(520)}`].map((key) => [key, 'apiable/big']),
  )

  const fallbackLines = (): string[] => logs.filter((line) => /size bound/.test(line))

  // contract: 024-7-4 S6
  it('F5: allows only the called address, logs the fallback once with no claim value, and never allows what a fresh call refuses', async () => {
    const h = load(BIG_MAP)
    expect(BIG_ROUTES.map((r) => address(r)).join('').length).toBeGreaterThan(4096)
    const plan = `${API}/${STAGE}/ANY/{proxy+}`
    const token = claims('apiable/big', plan, { extra_claim: EXTRA })

    const policy = await h.call(token, BIG_ROUTES[7])
    expect(allowedResources(policy)).toEqual([address(BIG_ROUTES[7])])
    expect(policy.principalId).toBe('sub-1')
    expect(policy.usageIdentifierKey).toBe(API_KEY)
    expectWellFormed(h, policy)
    for (const route of [...BIG_ROUTES, OUTSIDE, 'PUT /nothing']) {
      if (allows(policy, address(route))) {
        const fresh = await h.call(token, route)
        expect(allows(fresh, address(route))).toBe(true)
      }
    }

    logs = []
    await h.call(token, BIG_ROUTES[7])
    expect(fallbackLines()).toHaveLength(1)
    for (const line of logs) {
      for (const secret of [TOKEN, 'apiable/big', plan, API_KEY, EXTRA]) {
        expect(line).not.toContain(secret)
      }
    }
  })

  // contract: 024-7-4 S6
  it('F5: a plan that cuts the list below the bound gets the full list and no fallback', async () => {
    const h = load(BIG_MAP)
    const kept = BIG_ROUTES.slice(0, 3)
    const plan = kept.map((route) => `${API}/${STAGE}/${route.replace(' ', '')}`).join(';')

    logs = []
    const policy = await h.call(claims('apiable/big', plan), kept[1])
    expect(allowedResources(policy).sort()).toEqual(kept.map((r) => address(r)).sort())
    expect(fallbackLines()).toHaveLength(0)
    expectWellFormed(h, policy)
  })

  // contract: 024-7-4 S6
  // contract: 024-7-4 S7
  it.each([
    ['a called key holding *', 'GET /star*', ''],
    ['a called overlong address', `GET /${'y'.repeat(520)}`, ''],
    ['a plan that does not reach the called route', OUTSIDE, `${API}/${STAGE}/GET/r/*`],
  ])('F5: refuses with the untouched deny-all policy for %s', async (_name, route, plan) => {
    const h = load(BIG_MAP)
    logs = []
    const policy = await h.call(claims('apiable/big', plan), route)

    expect(policy).toBe(h.mod.defaultDenyAllPolicy)
    expect(policy.usageIdentifierKey).toBeUndefined()
    expect(logs.some((line) => line.startsWith('authorizer: deny'))).toBe(true)
    expect(logs.some((line) => line.startsWith('authorizer: allow'))).toBe(false)
    expectUntouchedDenyAll(h)
  })
})

describe('every refusal is unchanged', () => {
  // contract: 024-7-4 S7
  it('an unreadable scope map refuses with the deny-all policy', async () => {
    const h = load('not json')
    const policy = await h.call(claims('apiable/a'), 'GET /a')
    expect(policy).toBe(h.mod.defaultDenyAllPolicy)
    expectUntouchedDenyAll(h)
  })

  // contract: 024-7-4 S7
  it.each([
    ['a lone wildcard key', { 'GET /*': 'apiable/a' }, 'GET /*', ''],
    ['a plan that fences out every route', { 'GET /a': 'apiable/a' }, 'GET /a', `${API}/${STAGE}/DELETE/b`],
  ])('a call that passes the scope check but leaves nothing to allow (%s) is refused, logged as a refusal, and leaves the deny-all policy unchanged', async (_name, map, route, plan) => {
    const h = load(map)
    logs = []
    const refused = await h.call(claims('apiable/a', plan), route)

    expect(refused).toBe(h.mod.defaultDenyAllPolicy)
    expect(refused.usageIdentifierKey).toBeUndefined()
    expect(logs.some((line) => line.startsWith('authorizer: deny'))).toBe(true)
    expect(logs.some((line) => line.startsWith('authorizer: allow'))).toBe(false)
    expectUntouchedDenyAll(h)

    const other = await h.call({ client_id: 'client-2', sub: 'sub-2', scope: 'apiable/a' }, 'PUT /unmapped')
    expect(other).toStrictEqual(DENY_ALL_LITERAL)
    expectUntouchedDenyAll(h)
  })
})

describe("the snippet's parts of the handler, run alone, return the whole handler's policies", () => {
  /** The ranges the portal's snippet carries: the scope map and its parser, the deny-all policy, the marked core, the post-verification block. */
  const snippetParts = (source: string): { declarations: string; block: string } => {
    const lines = source.replace(/\n$/, '').split('\n')
    const find = (name: string, from: number, match: (line: string) => boolean): number => {
      for (let i = from; i < lines.length; i++) if (match(lines[i])) return i
      throw new Error(`the handler has no ${name}`)
    }
    const withComments = (start: number): number => {
      const indent = lines[start].match(/^ */)?.[0] ?? ''
      let first = start
      while (first > 0 && lines[first - 1].startsWith(`${indent}//`)) first--
      return first
    }
    const take = (first: number, last: number): string => lines.slice(first, last + 1).join('\n')

    const scopeMap = find('scope map', 0, (l) => l.startsWith('const REQUIRED_SCOPE_MAP = '))
    const parser = find('parser', scopeMap, (l) => l.startsWith('function parseRequiredScopeMap('))
    const denyAll = find('deny-all policy', 0, (l) => l.startsWith('export const defaultDenyAllPolicy'))
    const coreOpen = find('core marker', 0, (l) => l.startsWith('// --- preserved policy-generation core'))
    const coreClose = find('end core marker', coreOpen, (l) => l.startsWith('// --- end preserved core ---'))
    const routeKey = find('route key', 0, (l) => l === '  let routeKey')
    return {
      declarations: [
        take(withComments(scopeMap), find('end of parser', parser, (l) => l === '}')),
        take(withComments(denyAll), find('end of deny-all', denyAll, (l) => l === '}')),
        take(coreOpen, coreClose),
      ].join('\n'),
      block: take(withComments(routeKey), find('returned policy', routeKey, (l) => l === '  return policy')),
    }
  }

  type PartsHandler = (payload: Claims, event: { methodArn: string }) => Promise<AuthResponse>

  const loadParts = (map: Record<string, string>): PartsHandler => {
    const { declarations, block } = snippetParts(fs.readFileSync(HANDLER_SOURCE, 'utf8'))
    const text = `${declarations}\nexport async function partsHandler(payload, event) {\n${block}\n}\n`
    const { outputText } = ts.transpileModule(text, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      fileName: 'snippet-parts.ts',
    })
    const saved = process.env.REQUIRED_SCOPE_MAP
    process.env.REQUIRED_SCOPE_MAP = JSON.stringify(map)
    try {
      const exported: { partsHandler?: PartsHandler } = {}
      new Function('exports', outputText)(exported)
      if (!exported.partsHandler) throw new Error('the snippet parts did not load')
      return exported.partsHandler
    } finally {
      process.env.REQUIRED_SCOPE_MAP = saved
    }
  }

  const bigRoute = (i: number): string => `GET /r/${String(i).padStart(3, '0')}-${'segment'.repeat(10)}`
  const BIG_MAP: Record<string, string> = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [bigRoute(i), 'apiable/big']))

  const CASES: [string, Record<string, string>, Claims, string][] = [
    ['F1: one scope, no plan', AB_MAP, claims('apiable/a'), 'GET /a'],
    ['F2: both scopes, GET /a', AB_MAP, claims('apiable/a apiable/b'), 'GET /a'],
    ['F2: both scopes, DELETE /b', AB_MAP, claims('apiable/a apiable/b'), 'DELETE /b'],
    ['F3: a narrowing plan, allowed', AB_MAP, claims('apiable/a apiable/b', `${API}/${STAGE}/GET/a`), 'GET /a'],
    ['F3: a narrowing plan, fenced', AB_MAP, claims('apiable/a apiable/b', `${API}/${STAGE}/GET/a`), 'DELETE /b'],
    ['F3: a proxy plan', AB_MAP, claims('apiable/a apiable/b', `${API}/${STAGE}/ANY/{proxy+}`), 'DELETE /b'],
    ['F5: an oversize map', BIG_MAP, claims('apiable/big'), bigRoute(4)],
    ['a scope refusal', AB_MAP, claims('apiable/b'), 'GET /a'],
  ]

  // contract: 024-7-4 S10
  it.each(CASES)('F7: %s', async (_name, map, token, route) => {
    const whole = await load(map).call(token, route)
    const parts = await loadParts(map)(token, { methodArn: address(route) })
    expect(parts).toStrictEqual(whole)
  })
})

describe('the fix ships as a patch; nothing else moves', () => {
  // contract: 024-7-4 S11
  it('the authorizer is 1.2.1, no authorizer version is still offered, and the Terraform cache lifetime defaults to 0', () => {
    const version = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'lib/lambda-authorizer/package.json'), 'utf8')).version
    expect(version).toBe('1.2.1')

    const stillOffered = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'launchstack-still-offered.json'), 'utf8')) as {
      construct: string
    }[]
    expect(stillOffered.filter((entry) => entry.construct === 'apiable-lambda-authorizer')).toEqual([])

    const variables = parseHcl(
      fs.readFileSync(path.join(REPO_ROOT, 'terraform/apiable-lambda-authorizer/variables.tf'), 'utf8'),
    ).blocks
    const ttl = variables.find((b) => b.type === 'variable' && b.labels[0] === 'results_cache_ttl_seconds')
    expect(ttl?.attributes.default).toBe(0)
  })
})
