/**
 * Defensive narrowing helpers for reducing parsed-but-untyped artifact trees (CloudFormation
 * templates, `terraform show -json` output) into the typed parity model. Every external value
 * enters as `unknown` and is narrowed explicitly here, so the reducers never reach for `any`.
 */

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const asRecord = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? value : {}

export const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined

export const asArray = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : []

/** Coerce a CloudFormation/Terraform scalar to its string form for value comparison. */
export const asScalarString = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

/** A list of strings, dropping any non-string element. */
export const asStringArray = (value: unknown): string[] =>
  asArray(value).filter((v): v is string => typeof v === 'string')
