import { Router, type Request, type Response } from 'express';
import { asyncHandler, created, ok, paginate } from '../../lib/http.js';
import { actorOf, requireAuth, requireWorkspace } from '../../middleware/auth.js';
import { param, scopeOf } from '../../middleware/context.js';
import { idParamSchema, validate } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import * as service from './transaction.service.js';
import * as query from './transaction.query.js';
import {
  createTransactionSchema,
  duplicateTransactionSchema,
  listTransactionsSchema,
  updateTransactionSchema,
} from './transaction.schema.js';

export const transactionRouter: Router = Router();

transactionRouter.use(requireAuth, requireWorkspace);

function auditContext(req: Request) {
  const scope = scopeOf(req);
  return { userId: scope.userId, workspaceId: scope.workspaceId, ...actorOf(req) };
}

transactionRouter.get(
  '/',
  validate({ query: listTransactionsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const options = req.query as unknown as query.ListOptions;
    const result = await query.listTransactions(scopeOf(req), options);
    // The income/expense totals for the current filter ride along in `meta`, so a
    // filtered list can show its own summary without a second round trip.
    ok(res, paginate(result.items, result.total, options.page ?? 1, options.limit ?? 50), {
      ...result.meta,
    });
  }),
);

transactionRouter.post(
  '/',
  writeLimiter,
  validate({ body: createTransactionSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const scope = scopeOf(req);
    // An `Idempotency-Key` header is accepted as well as a body field, so a retry
    // wrapper can add it without knowing the payload shape.
    const idempotencyKey = req.body.idempotencyKey ?? req.get('idempotency-key') ?? undefined;

    const transaction = await service.createTransaction(
      scope,
      { ...req.body, idempotencyKey },
      auditContext(req),
    );
    created(res, await query.getTransaction(scope, String(transaction._id)));
  }),
);

transactionRouter.get(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await query.getTransaction(scopeOf(req), param(req, 'id')));
  }),
);

transactionRouter.patch(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema, body: updateTransactionSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const scope = scopeOf(req);
    await service.updateTransaction(scope, param(req, 'id'), req.body, auditContext(req));
    ok(res, await query.getTransaction(scope, param(req, 'id')));
  }),
);

/**
 * Soft delete. The response carries the id so the client can offer UNDO (§43)
 * without having to remember the payload it just discarded.
 */
transactionRouter.delete(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const transaction = await service.deleteTransaction(scopeOf(req), param(req, 'id'), auditContext(req));
    ok(res, { id: String(transaction._id), deleted: true, canUndo: true });
  }),
);

transactionRouter.post(
  '/:id/restore',
  writeLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const scope = scopeOf(req);
    await service.restoreTransaction(scope, param(req, 'id'), auditContext(req));
    ok(res, await query.getTransaction(scope, param(req, 'id')));
  }),
);

/** Copy an existing entry, changing only date and amount (§44). */
transactionRouter.post(
  '/:id/duplicate',
  writeLimiter,
  validate({ params: idParamSchema, body: duplicateTransactionSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const scope = scopeOf(req);
    const source = await query.getTransaction(scope, param(req, 'id'));

    const duplicate = await service.createTransaction(
      scope,
      {
        type: source.type,
        amountMinor: req.body.amountMinor ?? source.amountMinor,
        date: req.body.date ?? new Date(),
        accountId: source.accountId ?? source.fromAccountId!,
        toAccountId: source.toAccountId,
        categoryId: source.categoryId ?? null,
        subcategoryId: source.subcategoryId ?? null,
        personId: source.personId ?? null,
        description: source.description,
        notes: source.notes,
        paymentMethod: source.paymentMethod,
        tags: source.tags,
      },
      auditContext(req),
    );

    created(res, await query.getTransaction(scope, String(duplicate._id)));
  }),
);
