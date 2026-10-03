/**
 * Importing this module registers every model with Mongoose, which is what makes
 * `syncIndexes()` at boot able to find them all. Import it once from the app entry
 * point; everywhere else, import the specific model you need.
 */
export { User, DEFAULT_PREFERENCES, type IUser, type UserDocument } from './User.js';
export { RefreshToken, type IRefreshToken } from './RefreshToken.js';
export { Workspace, type IWorkspace } from './Workspace.js';
export { Account, type IAccount } from './Account.js';
export { Category, type ICategory } from './Category.js';
export { Person, type IPerson } from './Person.js';
export { Payee, type IPayee } from './Payee.js';
export { Transaction, type ITransaction, type IPosting } from './Transaction.js';
export { Budget, type IBudget } from './Budget.js';
export { SavingsGoal, type ISavingsGoal, type IGoalContribution } from './SavingsGoal.js';
export { RecurringTransaction, type IRecurringTransaction } from './RecurringTransaction.js';
export { Reminder, type IReminder } from './Reminder.js';
export { InstallmentPlan, type IInstallmentPlan, type IInstallment } from './InstallmentPlan.js';
export { ImportProfile, type IImportProfile } from './ImportProfile.js';
export { ExpenseGroup, type IExpenseGroup } from './ExpenseGroup.js';
export { WorkspaceMember, type IWorkspaceMember } from './WorkspaceMember.js';
export { Invitation, type IInvitation } from './Invitation.js';
export { GroupExpense, type IGroupExpense, type IGroupExpenseMemberShare } from './GroupExpense.js';
export { Notification, type INotification } from './Notification.js';
export { PushSubscription, type IPushSubscription } from './PushSubscription.js';
export { DetectorDismissal, type IDetectorDismissal } from './DetectorDismissal.js';
export { Attachment, type IAttachment } from './Attachment.js';
export { PettyCash, type IPettyCash } from './PettyCash.js';
export { DayClosing, MonthClosing, type IDayClosing, type IMonthClosing } from './Closing.js';
export { AuditLog, type IAuditLog } from './AuditLog.js';
export { Counter, type ICounter } from './Counter.js';
export { Project, type IProject } from './Project.js';
export { Invoice, type IInvoice, type ILineItem } from './Invoice.js';
export { Quotation, type IQuotation } from './Quotation.js';
export { PettyCashCount, type IPettyCashCount } from './PettyCashCount.js';
export { Product, type IProduct } from './Product.js';
export { StockMovement, type IStockMovement } from './StockMovement.js';
export { IdempotencyRecord, type IIdempotencyRecord } from './IdempotencyRecord.js';
export { CategoryRule, type ICategoryRule } from './CategoryRule.js';
export { SavedReport, type ISavedReport } from './SavedReport.js';
