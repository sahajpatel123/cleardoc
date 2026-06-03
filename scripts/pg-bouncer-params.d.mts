export declare function applyPgBouncerParams(rawUrl: string): string
export declare function isPoolerUrl(rawUrl: string): boolean
export declare function toSessionPoolerUrl(rawUrl: string): string
export declare const DATABASE_URL_KEYS: readonly string[]
export declare const DIRECT_DATABASE_URL_KEYS: readonly string[]
export declare function getFirstEnvValue(envObj: Record<string, string | undefined>, keys: readonly string[]): { key: string, value: string } | null
