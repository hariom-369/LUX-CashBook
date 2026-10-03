import { Router, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { ok } from './lib/http.js';
import { env } from './config/env.js';
import { optionalAuth, optionalWorkspace } from './middleware/auth.js';
import { idempotency } from './middleware/idempotency.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { userRouter } from './modules/users/user.routes.js';
import { workspaceRouter } from './modules/workspaces/workspace.routes.js';
import { accountRouter } from './modules/accounts/account.routes.js';
import { categoryRouter } from './modules/categories/category.routes.js';
import { personRouter } from './modules/people/person.routes.js';
import { payeeRouter } from './modules/payees/payee.routes.js';
import { transactionRouter } from './modules/transactions/transaction.routes.js';
import {
  cashBookRouter,
  dashboardRouter,
  integrityRouter,
} from './modules/dashboard/dashboard.routes.js';
import { budgetRouter } from './modules/budgets/budget.routes.js';
import { goalRouter } from './modules/goals/goal.routes.js';
import { recurringRouter } from './modules/recurring/recurring.routes.js';
import { reminderRouter } from './modules/reminders/reminder.routes.js';
import { notificationRouter } from './modules/notifications/notification.routes.js';
import { pushRouter } from './modules/push/push.routes.js';
import { detectorRouter } from './modules/detector/detector.routes.js';
import { loanRouter } from './modules/loans/loan.routes.js';
import { bankImportRouter } from './modules/bankimport/bankimport.routes.js';
import { forecastRouter } from './modules/forecast/forecast.routes.js';
import { groupRouter } from './modules/groups/group.routes.js';
import { memberRouter, invitationManagementRouter } from './modules/workspaces/member.routes.js';
import { inviteAcceptanceRouter } from './modules/workspaces/inviteAcceptance.routes.js';
import { reportRouter } from './modules/reports/report.routes.js';
import { attachmentRouter } from './modules/attachments/attachment.routes.js';
import { importExportRouter } from './modules/importexport/importexport.routes.js';
import { pdfRouter } from './modules/pdf/pdf.routes.js';
import { backupRouter } from './modules/backup/backup.routes.js';
import { pettyCashRouter } from './modules/pettycash/pettycash.routes.js';
import { closingRouter } from './modules/closing/closing.routes.js';
import { auditRouter } from './modules/audit/audit.routes.js';
import { aiRouter } from './modules/ai/ai.routes.js';
import { projectRouter } from './modules/projects/project.routes.js';
import { invoiceRouter } from './modules/invoices/invoice.routes.js';
import { quotationRouter } from './modules/quotations/quotation.routes.js';
import { productRouter } from './modules/inventory/product.routes.js';
import { tagRouter } from './modules/tags/tag.routes.js';
import { savedReportRouter } from './modules/reports/savedReport.routes.js';
import { categoryRuleRouter } from './modules/categories/categoryRule.routes.js';

/**
 * API surface, versioned at `/api/v1`.
 *
 * Routers are mounted in the order features were built; each one applies its own
 * `requireAuth` / `requireWorkspace` chain rather than relying on a blanket guard
 * here, so a new router cannot accidentally inherit (or miss) protection.
 */
export const apiRouter: Router = Router();

apiRouter.get('/health', (_req: Request, res: Response) => {
  const states: Record<number, string> = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };
  ok(res, {
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    database: states[mongoose.connection.readyState] ?? 'unknown',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Which gradually-rolled-out modules are switched on (shared/src/features.ts).
 * Starts from the server's `FEATURE_*` env defaults; a signed-in caller with a
 * resolvable workspace (via `X-Workspace-Id` or their saved active one) also
 * gets that workspace's overrides layered on top — a workspace can see a
 * module ahead of, or instead of, the global default. Works unauthenticated
 * too (defaults only), so the client can read it before sign-in.
 */
apiRouter.get('/features', optionalAuth, optionalWorkspace, (req: Request, res: Response) => {
  const overrides = req.workspace?.featureOverrides ?? {};
  ok(res, { ...env.features, ...overrides });
});

// Exactly-once writes for any request carrying an `Idempotency-Key` (middleware/idempotency.ts).
apiRouter.use(idempotency);

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/workspaces', workspaceRouter);

apiRouter.use('/accounts', accountRouter);
apiRouter.use('/categories', categoryRouter);
apiRouter.use('/people', personRouter);
apiRouter.use('/payees', payeeRouter);
apiRouter.use('/transactions', transactionRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/cash-book', cashBookRouter);
apiRouter.use('/integrity', integrityRouter);

apiRouter.use('/budgets', budgetRouter);
apiRouter.use('/goals', goalRouter);
apiRouter.use('/recurring', recurringRouter);
apiRouter.use('/reminders', reminderRouter);
apiRouter.use('/notifications', notificationRouter);
apiRouter.use('/push', pushRouter);
apiRouter.use('/detector', detectorRouter);
apiRouter.use('/loans', loanRouter);
apiRouter.use('/bank-import', bankImportRouter);
apiRouter.use('/forecast', forecastRouter);
apiRouter.use('/groups', groupRouter);
apiRouter.use('/members', memberRouter);
apiRouter.use('/workspace-invitations', invitationManagementRouter);
apiRouter.use('/invitations', inviteAcceptanceRouter);
apiRouter.use('/reports', reportRouter);

apiRouter.use('/attachments', attachmentRouter);
apiRouter.use('/import-export', importExportRouter);
apiRouter.use('/pdf', pdfRouter);
apiRouter.use('/backup', backupRouter);
apiRouter.use('/petty-cash', pettyCashRouter);
apiRouter.use('/closing', closingRouter);
apiRouter.use('/audit-log', auditRouter);
apiRouter.use('/ai', aiRouter);
apiRouter.use('/projects', projectRouter);
apiRouter.use('/invoices', invoiceRouter);
apiRouter.use('/quotations', quotationRouter);
apiRouter.use('/products', productRouter);
apiRouter.use('/tags', tagRouter);
apiRouter.use('/saved-reports', savedReportRouter);
apiRouter.use('/category-rules', categoryRuleRouter);
