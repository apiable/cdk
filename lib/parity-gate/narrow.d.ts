/**
 * Defensive narrowing helpers for reducing parsed-but-untyped artifact trees (CloudFormation
 * templates, `terraform show -json` output) into the typed parity model. Every external value
 * enters as `unknown` and is narrowed explicitly here, so the reducers never reach for `any`.
 */
export declare const isRecord: (value: unknown) => value is Record<string, unknown>;
export declare const asRecord: (value: unknown) => Record<string, unknown>;
export declare const asString: (value: unknown) => string | undefined;
export declare const asArray: (value: unknown) => readonly unknown[];
/** Coerce a CloudFormation/Terraform scalar to its string form for value comparison. */
export declare const asScalarString: (value: unknown) => string | undefined;
/** A list of strings, dropping any non-string element. */
export declare const asStringArray: (value: unknown) => string[];
