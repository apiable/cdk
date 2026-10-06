/**
 * The HCL reader is what the gateway-role specs read the Terraform module through, so a reader that
 * skipped or misread something would make those specs pass on text they never saw. These cases hold
 * the reader itself: what it returns for the syntax it models, that a comment is gone and a comment
 * marker inside a string is not, and that it refuses everything else.
 */
import { HclCall, HclRef, parseHcl } from './support/hcl'

describe('HCL reader — the syntax it models', () => {
  it('returns blocks with their labels, attributes and nested blocks', () => {
    const body = parseHcl(`
      limit = 3600
      variable "region" {
        type = string
        validation {
          condition = can(regex("^[a-z]+$", var.region))
        }
      }
    `)

    expect(body).toStrictEqual({
      attributes: { limit: 3600 },
      blocks: [
        {
          type: 'variable',
          labels: ['region'],
          attributes: { type: new HclRef('string') },
          blocks: [
            {
              type: 'validation',
              labels: [],
              attributes: { condition: new HclCall('can', [new HclCall('regex', ['^[a-z]+$', new HclRef('var.region')])]) },
              blocks: [],
            },
          ],
        },
      ],
    })
  })

  it('returns an object constructor as a record and a tuple as a list, with quoted keys and interpolations kept verbatim', () => {
    const { attributes } = parseHcl(`
      policy = jsonencode({
        Statement = [
          { Resource = "arn:aws:iam::\${var.account}:root", Condition = { "sts:ExternalId" = var.id } },
          { Resource = ["a", "b"] }
        ]
      })
    `)

    expect(attributes.policy).toStrictEqual(
      new HclCall('jsonencode', [
        {
          Statement: [
            { Resource: 'arn:aws:iam::${var.account}:root', Condition: { 'sts:ExternalId': new HclRef('var.id') } },
            { Resource: ['a', 'b'] },
          ],
        },
      ]),
    )
  })

  it('tells a reference from a string that spells one', () => {
    const { attributes } = parseHcl('a = var.id\nb = "var.id"')

    expect(attributes.a).toStrictEqual(new HclRef('var.id'))
    expect(attributes.b).toBe('var.id')
    expect(attributes.a).not.toStrictEqual(attributes.b)
  })

  it('unescapes a string the way the engine reads it', () => {
    expect(parseHcl('pattern = "^([0-9]{1,3}\\\\.){3}$"').attributes.pattern).toBe('^([0-9]{1,3}\\.){3}$')
  })
})

describe('HCL reader — comments', () => {
  it('drops a commented-out attribute, whichever comment form hides it', () => {
    const { attributes } = parseHcl(`
      kept = "yes"
      # hash = "no"
      // slashes = "no"
      /* block = "no"
         still = "no" */
      trailing = "yes" # tail = "no"
    `)

    expect(attributes).toStrictEqual({ kept: 'yes', trailing: 'yes' })
  })

  it('drops a comment inside an object constructor', () => {
    const { attributes } = parseHcl(`
      trust = {
        Effect = "Allow"
        # Condition = { StringEquals = { "sts:ExternalId" = var.id } }
      }
    `)

    expect(attributes.trust).toStrictEqual({ Effect: 'Allow' })
  })

  it('keeps a comment marker that sits inside a string', () => {
    const { attributes } = parseHcl('a = "arn:aws:apigateway:::/restapis/*"\nb = "x # y"\nc = "x // y"\nd = "/* x */"')

    expect(attributes).toStrictEqual({ a: 'arn:aws:apigateway:::/restapis/*', b: 'x # y', c: 'x // y', d: '/* x */' })
  })
})

describe('HCL reader — everything else is refused', () => {
  it.each([
    ['an operator after a call', 'condition = can(regex("a", var.id)) || true'],
    ['a negation', 'condition = !can(regex("a", var.id))'],
    ['a conditional', 'a = var.on ? "x" : "y"'],
    ['an index', 'a = var.list[0]'],
    ['a for expression', 'a = [for x in var.list : x]'],
    ['a heredoc', 'a = <<EOT\nx\nEOT'],
    ['a string that never closes', 'a = "x'],
    ['a block comment that never closes', 'a = "x" /* y'],
    ['a block that never closes', 'variable "x" {\n  type = string'],
    ['a quote inside an interpolation', 'a = "${lookup(var.map, "key")}"'],
    ['an attribute given twice', 'a = "x"\na = "y"'],
    ['an object key given twice', 'a = { Effect = "Allow", Effect = "Deny" }'],
  ])('refuses %s', (_label, text) => {
    expect(() => parseHcl(text)).toThrow(/HCL this reader does not model/)
  })
})
