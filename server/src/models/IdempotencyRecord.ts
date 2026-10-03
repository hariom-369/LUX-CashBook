import { Schema, type Types } from 'mongoose';
import { defineModel, baseOptions } from './shared.js';

/**
 * One request the API has been asked to perform exactly once (§Phase 15 follow-up).
 *
 * A client that loses the connection after sending a create cannot know whether the
 * server applied it. It retries with the same `Idempotency-Key`; this record is what
 * lets the server answer "I already did that — here is the result" instead of doing
 * it twice. See `middleware/idempotency.ts`.
 */
export interface IIdempotencyRecord {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  key: string;
  /** Hash of method + path + workspace + body: a key reused for a *different* request is refused. */
  fingerprint: string;
  state: 'pending' | 'done';
  statusCode?: number;
  /** The JSON body that was returned, replayed verbatim on a repeat. */
  body?: unknown;
  createdAt: Date;
  updatedAt: Date;
}

const idempotencyRecordSchema = new Schema<IIdempotencyRecord>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    key: { type: String, required: true, maxlength: 128 },
    fingerprint: { type: String, required: true, maxlength: 64 },
    state: { type: String, enum: ['pending', 'done'], required: true },
    statusCode: { type: Number },
    body: { type: Schema.Types.Mixed },
  },
  // `minimize: false` keeps empty objects in a stored response, so a replay is byte-for-byte the original.
  { ...baseOptions, minimize: false },
);

// One result per (user, key). The unique index is the concurrency guard: of two
// simultaneous identical requests, exactly one inserts.
idempotencyRecordSchema.index({ userId: 1, key: 1 }, { unique: true });
// Keys are only meaningful for a retry window. Thirty days comfortably outlasts any
// realistic time a phone sits offline with a queued entry.
idempotencyRecordSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const IdempotencyRecord = defineModel<IIdempotencyRecord>('IdempotencyRecord', idempotencyRecordSchema);
