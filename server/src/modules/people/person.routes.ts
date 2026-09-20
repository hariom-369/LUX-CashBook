import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { PERSON_RELATIONSHIPS } from '@khata/shared';
import { asyncHandler, created, ok } from '../../lib/http.js';
import { actorOf, requireAuth, requireWorkspace } from '../../middleware/auth.js';
import { param, scopeOf } from '../../middleware/context.js';
import {
  amountMinorSchema,
  dateSchema,
  idParamSchema,
  objectIdSchema,
  positiveAmountSchema,
  tagsSchema,
  text,
  validate,
} from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import * as service from './person.service.js';
import { createTransaction } from '../transactions/transaction.service.js';
import { getTransaction } from '../transactions/transaction.query.js';

export const personRouter: Router = Router();

personRouter.use(requireAuth, requireWorkspace);

const auditContext = (req: Request) => {
  const scope = scopeOf(req);
  return { userId: scope.userId, workspaceId: scope.workspaceId, ...actorOf(req) };
};

const createSchema = z.object({
  name: z.string().trim().min(1, 'Enter their name.').max(80),
  phone: text(24),
  email: z.string().trim().email('Enter a valid email address.').optional().or(z.literal('')),
  avatarUrl: text(512),
  relationship: z.enum(PERSON_RELATIONSHIPS).default('friend'),
  notes: text(1000),
  tags: tagsSchema,
  /** Positive = they owe you. Negative = you owe them. */
  openingBalanceMinor: amountMinorSchema.default(0),
  openingDate: dateSchema.optional(),
});

const updateSchema = createSchema.partial().extend({ isArchived: z.boolean().optional() });

/** Shared shape for lend / borrow / repay. */
const moneyMoveSchema = z.object({
  amountMinor: positiveAmountSchema,
  accountId: objectIdSchema,
  date: dateSchema.optional(),
  dueDate: dateSchema.nullable().optional(),
  note: text(200),
  referenceNo: text(60),
  /** Repayments only: pay down one specific loan instead of oldest-first. */
  parentTransactionId: objectIdSchema.nullable().optional(),
  idempotencyKey: z.string().min(8).max(64).optional(),
});

personRouter.get(
  '/',
  validate({
    query: z.object({
      search: z.string().trim().max(120).optional(),
      relationship: z.enum(PERSON_RELATIONSHIPS).optional(),
      status: z.enum(['receivable', 'payable', 'settled', 'all']).default('all'),
      includeArchived: z.coerce.boolean().default(false),
      sortBy: z.enum(['name', 'balance', 'recent']).default('name'),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const people = await service.listPeople(scopeOf(req), req.query as Record<string, never>);

    const receivableMinor = people.filter((p) => p.balanceMinor > 0).reduce((s, p) => s + p.balanceMinor, 0);
    const payableMinor = people.filter((p) => p.balanceMinor < 0).reduce((s, p) => s - p.balanceMinor, 0);

    ok(res, people, { receivableMinor, payableMinor, count: people.length });
  }),
);

/** Totals for the dashboard panels (§7). */
personRouter.get(
  '/summary',
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.getReceivablesAndPayables(scopeOf(req)));
  }),
);

personRouter.post(
  '/',
  writeLimiter,
  validate({ body: createSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const person = await service.createPerson(scopeOf(req), req.body, auditContext(req));
    created(res, service.toPersonDto(person));
  }),
);

personRouter.get(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const person = await service.getPerson(scopeOf(req), param(req, 'id'));
    ok(res, service.toPersonDto(person));
  }),
);

personRouter.patch(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema, body: updateSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const person = await service.updatePerson(scopeOf(req), param(req, 'id'), req.body, auditContext(req));
    ok(res, service.toPersonDto(person));
  }),
);

personRouter.delete(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.deletePerson(scopeOf(req), param(req, 'id'), auditContext(req));
    ok(res, { deleted: true });
  }),
);

/** The chronological khata for one person (§13). */
personRouter.get(
  '/:id/ledger',
  validate({
    params: idParamSchema,
    query: z.object({ from: dateSchema.optional(), to: dateSchema.optional() }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const ledger = await service.getPersonLedger(
      scopeOf(req),
      param(req, 'id'),
      req.query as { from?: Date; to?: Date },
    );
    ok(res, ledger);
  }),
);

/**
 * The four money movements, as named endpoints (§61).
 *
 * They all funnel into `createTransaction`, so there is exactly one implementation
 * of the ledger rules — these exist because "give money to Rahul" is what the user
 * is doing, and a URL that says so is easier to get right than a generic
 * transaction POST with the correct type and sign.
 */
personRouter.post(
  '/:id/lend',
  writeLimiter,
  validate({ params: idParamSchema, body: moneyMoveSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const scope = scopeOf(req);
    const person = await service.getPerson(scope, param(req, 'id'));

    const transaction = await createTransaction(
      scope,
      {
        type: 'lend',
        amountMinor: req.body.amountMinor,
        date: req.body.date ?? new Date(),
        accountId: req.body.accountId,
        personId: String(person._id),
        description: req.body.note || `Gave to ${person.name}`,
        referenceNo: req.body.referenceNo,
        dueDate: req.body.dueDate ?? null,
        idempotencyKey: req.body.idempotencyKey,
      },
      auditContext(req),
    );

    created(res, await getTransaction(scope, String(transaction._id)));
  }),
);

personRouter.post(
  '/:id/borrow',
  writeLimiter,
  validate({ params: idParamSchema, body: moneyMoveSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const scope = scopeOf(req);
    const person = await service.getPerson(scope, param(req, 'id'));

    const transaction = await createTransaction(
      scope,
      {
        type: 'borrow',
        amountMinor: req.body.amountMinor,
        date: req.body.date ?? new Date(),
        accountId: req.body.accountId,
        personId: String(person._id),
        description: req.body.note || `Borrowed from ${person.name}`,
        referenceNo: req.body.referenceNo,
        dueDate: req.body.dueDate ?? null,
        idempotencyKey: req.body.idempotencyKey,
      },
      auditContext(req),
    );

    created(res, await getTransaction(scope, String(transaction._id)));
  }),
);

/**
 * Record a repayment.
 *
 * The direction is derived from the person's balance rather than asked for: if they
 * owe you, a repayment is money coming in. Partial amounts are the normal case
 * (§16) and are allocated oldest-debt-first by the service.
 */
personRouter.post(
  '/:id/repay',
  writeLimiter,
  validate({
    params: idParamSchema,
    body: moneyMoveSchema.extend({ direction: z.enum(['received', 'given']).optional() }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const scope = scopeOf(req);
    const person = await service.getPerson(scope, param(req, 'id'));

    const inferred = person.cachedBalanceMinor > 0 ? 'received' : 'given';
    const direction = req.body.direction ?? inferred;
    const type = direction === 'received' ? 'repayment_received' : 'repayment_given';

    const transaction = await createTransaction(
      scope,
      {
        type,
        amountMinor: req.body.amountMinor,
        date: req.body.date ?? new Date(),
        accountId: req.body.accountId,
        personId: String(person._id),
        parentTransactionId: req.body.parentTransactionId ?? null,
        description:
          req.body.note ||
          (direction === 'received' ? `Received from ${person.name}` : `Repaid ${person.name}`),
        referenceNo: req.body.referenceNo,
        idempotencyKey: req.body.idempotencyKey,
      },
      auditContext(req),
    );

    created(res, await getTransaction(scope, String(transaction._id)));
  }),
);

/** Clear the whole outstanding balance in one entry (§17). */
personRouter.post(
  '/:id/settle',
  writeLimiter,
  validate({
    params: idParamSchema,
    body: z.object({
      accountId: objectIdSchema,
      date: dateSchema.optional(),
      note: text(200),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.settlePerson(scopeOf(req), param(req, 'id'), req.body, auditContext(req)));
  }),
);
