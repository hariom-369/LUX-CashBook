import { Router, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { ok } from './lib/http.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { userRouter } from './modules/users/user.routes.js';
import { workspaceRouter } from './modules/workspaces/workspace.routes.js';
import { accountRouter } from './modules/accounts/account.routes.js';
import { categoryRouter } from './modules/categories/category.routes.js';
import { personRouter } from './modules/people/person.routes.js';
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
import { reportRouter } from './modules/reports/report.routes.js';
import { attachmentRouter } from './modules/attachments/attachment.routes.js';
import { importExportRouter } from './modules/importexport/importexport.routes.js';
import { pdfRouter } from './modules/pdf/pdf.routes.js';
import { backupRouter } from './modules/backup/backup.routes.js';
import { pettyCashRouter } from './modules/pettycash/pettycash.routes.js';
import { closingRouter } from './modules/closing/closing.routes.js';
import { auditRouter } from './modules/audit/audit.routes.js';

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

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/workspaces', workspaceRouter);

apiRouter.use('/accounts', accountRouter);
apiRouter.use('/categories', categoryRouter);
apiRouter.use('/people', personRouter);
apiRouter.use('/transactions', transactionRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/cash-book', cashBookRouter);
apiRouter.use('/integrity', integrityRouter);

apiRouter.use('/budgets', budgetRouter);
apiRouter.use('/goals', goalRouter);
apiRouter.use('/recurring', recurringRouter);
apiRouter.use('/reminders', reminderRouter);
apiRouter.use('/notifications', notificationRouter);
apiRouter.use('/reports', reportRouter);

apiRouter.use('/attachments', attachmentRouter);
apiRouter.use('/import-export', importExportRouter);
apiRouter.use('/pdf', pdfRouter);
apiRouter.use('/backup', backupRouter);
apiRouter.use('/petty-cash', pettyCashRouter);
apiRouter.use('/closing', closingRouter);
apiRouter.use('/audit-log', auditRouter);
