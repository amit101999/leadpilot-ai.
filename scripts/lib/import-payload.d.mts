/** Types for import-payload.mjs (the project does not type-check plain JavaScript). */
export declare const MAX_REQUEST_BYTES: number;
export declare const MAX_JOBS_PER_REQUEST: number;
export declare function slimJob(job: Record<string, unknown>, details?: unknown): Record<string, unknown>;
export declare function chunkJobs<T>(jobs: T[], maxBytes?: number, maxCount?: number): T[][];
