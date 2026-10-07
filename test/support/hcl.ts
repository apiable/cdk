/**
 * A reader for the slice of HCL the gateway-role Terraform module is written in: blocks, attributes,
 * strings, numbers, references, calls, object constructors and tuples. It lets a spec hold the module
 * to what it declares, with comments gone the way the engine drops them, where a match over the raw
 * text would also read a commented-out line.
 *
 * Anything outside that slice throws. A module that grows syntax this does not model then fails the
 * spec that reads it, where a reader that skipped what it did not understand would pass it unread.
 */

/** A reference such as `var.external_id` or `aws_iam_role.this.id`, kept apart from a string that merely spells one. */
export class HclRef {
  constructor(readonly path: string) {}
}

/** A function call such as `jsonencode(...)`. */
export class HclCall {
  constructor(
    readonly name: string,
    readonly args: readonly HclValue[],
  ) {}
}

/** A string keeps any `${...}` interpolation verbatim; an object constructor is a plain record. */
export type HclValue = string | number | HclRef | HclCall | readonly HclValue[] | { readonly [key: string]: HclValue }

export interface HclBody {
  readonly attributes: Readonly<Record<string, HclValue>>
  readonly blocks: readonly HclBlock[]
}

export interface HclBlock extends HclBody {
  readonly type: string
  readonly labels: readonly string[]
}

type Token =
  | { readonly kind: 'punct' | 'ident' | 'string'; readonly value: string; readonly at: number }
  | { readonly kind: 'number'; readonly value: number; readonly at: number }

const PUNCTUATION = '{}[]()=,.:'
const ESCAPES: Readonly<Record<string, string>> = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' }

const refuse = (at: number, what: string): never => {
  throw new Error(`HCL this reader does not model, at offset ${at}: ${what}`)
}

const tokenize = (text: string): Token[] => {
  const tokens: Token[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (/\s/.test(ch)) {
      i += 1
    } else if (ch === '#' || text.startsWith('//', i)) {
      const end = text.indexOf('\n', i)
      i = end === -1 ? text.length : end
    } else if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2)
      if (end === -1) refuse(i, 'a block comment that never closes')
      i = end + 2
    } else if (ch === '"') {
      const at = i
      let value = ''
      i += 1
      while (text[i] !== '"') {
        if (i >= text.length || text[i] === '\n') refuse(at, 'a string that never closes')
        if (text[i] === '\\') {
          const unescaped = ESCAPES[text[i + 1]]
          if (unescaped === undefined) refuse(i, `the escape \\${text[i + 1]}`)
          value += unescaped
          i += 2
        } else if (text.startsWith('${', i)) {
          // Copied verbatim to its closing brace. A quote or a brace inside one would end the string or
          // the interpolation somewhere else for the engine than it does here, so it is refused.
          const end = text.indexOf('}', i)
          const interpolation = end === -1 ? '' : text.slice(i, end + 1)
          if (end === -1 || /["{\n]/.test(interpolation.slice(2, -1))) refuse(i, 'an interpolation that is not a plain reference')
          value += interpolation
          i = end + 1
        } else {
          value += text[i]
          i += 1
        }
      }
      i += 1
      tokens.push({ kind: 'string', value, at })
    } else if (/[A-Za-z_]/.test(ch)) {
      const [value] = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(text.slice(i)) as RegExpExecArray
      tokens.push({ kind: 'ident', value, at: i })
      i += value.length
    } else if (/[0-9]/.test(ch)) {
      const [value] = /^[0-9]+(\.[0-9]+)?/.exec(text.slice(i)) as RegExpExecArray
      tokens.push({ kind: 'number', value: Number(value), at: i })
      i += value.length
    } else if (PUNCTUATION.includes(ch)) {
      tokens.push({ kind: 'punct', value: ch, at: i })
      i += 1
    } else {
      refuse(i, `the character ${JSON.stringify(ch)}`)
    }
  }
  return tokens
}

/** Parse the text of one `.tf` file into its top-level attributes and blocks. */
export const parseHcl = (text: string): HclBody => {
  const tokens = tokenize(text)
  let p = 0

  const at = (): number => tokens[p]?.at ?? text.length
  const isPunct = (value: string): boolean => tokens[p]?.kind === 'punct' && tokens[p].value === value
  const expectPunct = (value: string): void => {
    if (!isPunct(value)) refuse(at(), `expected ${value}`)
    p += 1
  }
  const record = <T>(entries: readonly (readonly [string, T])[], what: string): Record<string, T> => {
    const seen = new Set<string>()
    for (const [key] of entries) {
      if (seen.has(key)) refuse(at(), `${what} ${JSON.stringify(key)} given twice`)
      seen.add(key)
    }
    return Object.fromEntries(entries)
  }

  const parseList = (close: string): HclValue[] => {
    const items: HclValue[] = []
    while (!isPunct(close)) {
      items.push(parseValue())
      if (!isPunct(close)) expectPunct(',')
    }
    p += 1
    return items
  }

  const parseObject = (): { [key: string]: HclValue } => {
    const entries: [string, HclValue][] = []
    while (!isPunct('}')) {
      const key = tokens[p]
      if (key === undefined || (key.kind !== 'ident' && key.kind !== 'string')) return refuse(at(), 'an object key that is not a name or a string')
      p += 1
      if (!isPunct('=') && !isPunct(':')) refuse(at(), 'expected = after an object key')
      p += 1
      entries.push([key.value, parseValue()])
      if (isPunct(',')) p += 1
    }
    p += 1
    return record(entries, 'the object key')
  }

  const parseValue = (): HclValue => {
    const token = tokens[p]
    if (token === undefined) return refuse(text.length, 'a value that never arrives')
    p += 1
    if (token.kind === 'string' || token.kind === 'number') return token.value
    if (token.kind === 'punct' && token.value === '[') return parseList(']')
    if (token.kind === 'punct' && token.value === '{') return parseObject()
    if (token.kind !== 'ident') return refuse(token.at, `the token ${JSON.stringify(token.value)} where a value belongs`)
    if (isPunct('(')) {
      p += 1
      return new HclCall(token.value, parseList(')'))
    }
    let path = token.value
    while (isPunct('.')) {
      const next = tokens[p + 1]
      if (next === undefined || next.kind !== 'ident') return refuse(at(), 'a reference that does not end in a name')
      path += `.${next.value}`
      p += 2
    }
    return new HclRef(path)
  }

  const parseBody = (isClosed: () => boolean): HclBody => {
    const attributes: [string, HclValue][] = []
    const blocks: HclBlock[] = []
    while (!isClosed()) {
      const name = tokens[p]
      if (name === undefined || name.kind !== 'ident') return refuse(at(), 'an attribute or block that does not start with a name')
      p += 1
      if (isPunct('=')) {
        p += 1
        attributes.push([name.value, parseValue()])
      } else {
        const labels: string[] = []
        while (!isPunct('{')) {
          const label = tokens[p]
          if (label === undefined || (label.kind !== 'ident' && label.kind !== 'string')) return refuse(at(), 'a block label that is not a name or a string')
          labels.push(label.value)
          p += 1
        }
        p += 1
        const body = parseBody(() => isPunct('}'))
        p += 1
        blocks.push({ type: name.value, labels, ...body })
      }
    }
    return { attributes: record(attributes, 'the attribute'), blocks }
  }

  return parseBody(() => p >= tokens.length)
}
