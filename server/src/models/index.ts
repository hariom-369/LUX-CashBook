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
export { Transaction, type ITransaction, type IPosting } from './Transaction.js';
export { Budget, type IBudget } from './Budget.js';
export { SavingsGoal, type ISavingsGoal, type IGoalContribution } from './SavingsGoal.js';
export { RecurringTransaction, type IRecurringTransaction } from './RecurringTransaction.js';
export { Reminder, type IReminder } from './Reminder.js';
export { Notification, type INotification } from './Notification.js';
export { Attachment, type IAttachment } from './Attachment.js';
export { PettyCash, type IPettyCash } from './PettyCash.js';
export { DayClosing, MonthClosing, type IDayClosing, type IMonthClosing } from './Closing.js';
export { AuditLog, type IAuditLog } from './AuditLog.js';
