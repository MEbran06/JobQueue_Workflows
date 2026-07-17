import { Queue } from 'bullmq';

const connection = { url: process.env.REDIS_URL ?? 'redis://localhost:6379' };

export const workflowQueue = new Queue('workflow-steps', { connection });

// bullmq's queue.client getter is typed as IRedisClient, a curated cross-adapter
// command subset that does not declare rpush/incr/exists (only get/set/read-
// oriented list-hash-set ops/etc). This is a TypeScript type-narrowing limit,
// not a runtime one - the underlying object (ioredis, the default adapter) has
// working rpush/incr/exists methods, verified directly against a live
// connection; IRedisClient just doesn't declare them for cross-adapter
// portability. Cast to this interface at each call site that needs one of
// these three, rather than widening the whole `redis` variable's type.
export interface ExtraRedisCommands {
    rpush(key: string, ...values: string[]): Promise<number>;
    incr(key: string): Promise<number>;
    exists(...keys: string[]): Promise<number>;
}