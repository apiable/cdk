/** S3 object key of a published token-stream template version, immutable per version. */
export declare const tokensLaunchStackTemplateKey: (version: string) => string;
/** Canonical s3:// address of a published token-stream template version. */
export declare const tokensLaunchStackTemplateS3Uri: (version: string, bucket?: string | undefined) => string;
/**
 * Build a one-click AWS Console launch-stack URL for the published token-stream template, with the
 * customer's values pre-filled as deployment parameters.
 *
 * Throws when a required value is missing or when the storage location is not a valid S3 bucket ARN, so
 * a link never carries a blank or malformed destination.
 */
export declare const generateTokensLaunchStackUrl: (input: import("./launch-stack-url").LaunchStackUrlInput) => string;
