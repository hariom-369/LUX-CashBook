/**
 * API contract types.
 *
 * These describe what crosses the wire — the JSON the server sends and the client
 * consumes. They deliberately do *not* mirror the Mongoose documents: `_id` is
 * always serialised as `id`, dates are always ISO strings, and internal fields
 * (password hashes, token families) never appear here at all.
 */

import type {
  AccountType, AuditAction, CategoryKind, DateFormat, NotificationType, PaymentMethod,
  PersonRelationship, RecurrenceFrequency, ReminderType, Theme, TransactionType, WorkspaceMode,
} from './constants.js';

// ─────────────────────────────────────────────── Envelopes

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiFieldError {
  path: string;
  message: string;
}

export interface ApiError {
  ok: false;
  error: {
    /** Stable machine-readable code — the client switches on this, never on the message. */
    code: string;
    /** Human-readable, safe to show to a user verbatim (§57). */
    message: string;
    fields?: ApiFieldError[];
    requestId?: string;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

// ─────────────────────────────────────────────── User & session

export interface UserPreferences {
  currency: string;
  country: string;
  dateFormat: DateFormat;
  /** 0 = Sunday … 6 = Saturday */
  firstDayOfWeek: number;
  timeZone: string;
  theme: Theme;
  language: string;
  /** Show Debit/Credit/contra terminology instead of Money In/Money Out (§54). */
  accountingView: boolean;
  /** Mask every figure on load (§38). */
  privacyModeDefault: boolean;
  numberFormat: 'indian' | 'western';
  notifications: {
    inApp: boolean;
    email: boolean;
    push: boolean;
    moneyDue: boolean;
    budgetAlerts: boolean;
    recurringReminders: boolean;
    monthlySummary: boolean;
    /** Minutes before a due date to notify. */
    dueLeadDays: number;
  };
  security: {
    pinEnabled: boolean;
    biometricEnabled: boolean;
    /** Minutes of inactivity before the app re-locks. 0 = never. */
    sessionTimeoutMinutes: number;
  };
}

export interface UserDto {
  id: string;
  name: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  emailVerified: boolean;
  onboardingCompleted: boolean;
  preferences: UserPreferences;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSessionDto {
  user: UserDto;
  workspaces: WorkspaceDto[];
  activeWorkspaceId: string | null;
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

// ─────────────────────────────────────────────── Workspace

export interface WorkspaceDto {
  id: string;
  name: string;
  mode: WorkspaceMode;
  currency: string;
  isDefault: boolean;
  /** Demo workspaces are visually flagged and can be wiped in one action (§67). */
  isDemo: boolean;
  /** Business only: financial year start month, 1–12. Defaults to 4 (April) for IN. */
  fiscalYearStartMonth: number;
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────── Account

export interface AccountDto {
  id: string;
  workspaceId: string;
  name: string;
  type: AccountType;
  currency: string;
  openingBalanceMinor: number;
  openingDate: string;
  /** Derived from postings — never independently authoritative (invariant I2). */
  balanceMinor: number;
  bankName?: string;
  last4?: string;
  color: string;
  icon: string;
  isActive: boolean;
  /** Credit cards and loans count against net worth. */
  isLiability: boolean;
  /** Refuse writes that would push this account below zero. */
  blockNegativeBalance: boolean;
  /** Credit cards: the sanctioned limit, for utilisation display. */
  creditLimitMinor?: number;
  excludeFromTotals: boolean;
  notes?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────── Category

export interface CategoryDto {
  id: string;
  workspaceId: string;
  name: string;
  kind: CategoryKind;
  icon: string;
  color: string;
  parentId: string | null;
  isSystem: boolean;
  isArchived: boolean;
  sortOrder: number;
  children?: CategoryDto[];
}

// ─────────────────────────────────────────────── Person

export interface PersonDto {
  id: string;
  workspaceId: string;
  name: string;
  phone?: string;
  email?: string;
  avatarUrl?: string;
  relationship: PersonRelationship;
  notes?: string;
  tags: string[];
  openingBalanceMinor: number;
  /** > 0 they owe you · < 0 you owe them · 0 settled (ARCHITECTURE §3.3). */
  balanceMinor: number;
  isArchived: boolean;
  lastTransactionAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LedgerRowDto {
  id: string;
  date: string;
  description: string;
  type: TransactionType;
  /** Money you gave them (increases what they owe you). */
  gaveMinor: number;
  /** Money you received from them. */
  receivedMinor: number;
  /** Running outstanding after this row. */
  balanceMinor: number;
  accountId?: string;
  accountName?: string;
  dueDate?: string;
  isSettlement: boolean;
}

export interface PersonLedgerDto {
  person: PersonDto;
  rows: LedgerRowDto[];
  summary: {
    openingBalanceMinor: number;
    totalGivenMinor: number;
    totalReceivedMinor: number;
    outstandingMinor: number;
    /** `receivable` you will get money · `payable` you owe · `settled`. */
    status: 'receivable' | 'payable' | 'settled';
    overdueMinor: number;
    nextDueDate?: string;
  };
}

// ─────────────────────────────────────────────── Transaction

export interface PostingDto {
  accountId: string;
  accountName?: string;
  /** Signed: negative leaves the account, positive enters it. */
  amountMinor: number;
}

export interface AttachmentDto {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  thumbnailUrl?: string;
  uploadedAt: string;
}

export interface TransactionDto {
  id: string;
  workspaceId: string;
  type: TransactionType;
  /** Always positive. Direction lives in `postings` and `type`. */
  amountMinor: number;
  currency: string;
  /** ISO datetime — the moment the money moved, in the user's timezone. */
  date: string;
  postings: PostingDto[];
  /** Convenience mirrors of `postings` for simple (non-transfer) types. */
  accountId?: string;
  accountName?: string;
  fromAccountId?: string;
  toAccountId?: string;
  categoryId?: string;
  categoryName?: string;
  categoryIcon?: string;
  categoryColor?: string;
  subcategoryId?: string;
  subcategoryName?: string;
  personId?: string;
  personName?: string;
  description: string;
  notes?: string;
  paymentMethod?: PaymentMethod;
  referenceNo?: string;
  tags: string[];
  attachments: AttachmentDto[];
  /** Lend/borrow only. */
  dueDate?: string;
  /** Repayments point at the lend/borrow they settle. */
  parentTransactionId?: string;
  /** Lend/borrow only — how much of this loan is still outstanding. */
  outstandingMinor?: number;
  isSettled?: boolean;
  /** Cash book: discount allowed/received on this entry (§10 triple column). */
  discountMinor?: number;
  recurringId?: string;
  isRecurringInstance: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface TransactionListMeta {
  totalIncomeMinor: number;
  totalExpenseMinor: number;
  netMinor: number;
  count: number;
}

// ─────────────────────────────────────────────── Cash book

export interface CashBookRowDto {
  id: string;
  date: string;
  particulars: string;
  referenceNo?: string;
  /** Single column view. */
  receiptMinor: number;
  paymentMinor: number;
  /** Double / triple column view. */
  cashReceiptMinor: number;
  cashPaymentMinor: number;
  bankReceiptMinor: number;
  bankPaymentMinor: number;
  discountAllowedMinor: number;
  discountReceivedMinor: number;
  /** Running balance after this row, for the active view. */
  balanceMinor: number;
  cashBalanceMinor: number;
  bankBalanceMinor: number;
  isContra: boolean;
  type: TransactionType;
  personName?: string;
  categoryName?: string;
}

export interface CashBookDto {
  view: 'single' | 'double' | 'triple';
  from: string;
  to: string;
  opening: { totalMinor: number; cashMinor: number; bankMinor: number };
  closing: { totalMinor: number; cashMinor: number; bankMinor: number };
  totals: {
    receiptMinor: number; paymentMinor: number;
    cashReceiptMinor: number; cashPaymentMinor: number;
    bankReceiptMinor: number; bankPaymentMinor: number;
    discountAllowedMinor: number; discountReceivedMinor: number;
  };
  rows: CashBookRowDto[];
}

// ─────────────────────────────────────────────── Dashboard

export interface DashboardDto {
  totalBalanceMinor: number;
  netWorthMinor: number;
  accounts: Array<Pick<AccountDto, 'id' | 'name' | 'type' | 'balanceMinor' | 'color' | 'icon' | 'isLiability'>>;
  month: {
    label: string;
    incomeMinor: number;
    expenseMinor: number;
    netSavingsMinor: number;
    savingsRate: number;
    /** Same figures for the previous month, for the delta chips. */
    previousIncomeMinor: number;
    previousExpenseMinor: number;
  };
  cashFlow: CashFlowPointDto[];
  recentTransactions: TransactionDto[];
  receivables: { totalMinor: number; people: PersonSummaryDto[] };
  payables: { totalMinor: number; people: PersonSummaryDto[] };
  upcoming: UpcomingItemDto[];
  budgets: BudgetProgressDto[];
  goals: GoalProgressDto[];
  insights: InsightDto[];
}

export interface PersonSummaryDto {
  id: string;
  name: string;
  avatarUrl?: string;
  amountMinor: number;
  dueDate?: string;
  isOverdue: boolean;
}

export interface CashFlowPointDto {
  /** ISO date or bucket label. */
  bucket: string;
  label: string;
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
  balanceMinor?: number;
}

export interface UpcomingItemDto {
  id: string;
  kind: 'recurring' | 'reminder' | 'receivable' | 'payable';
  title: string;
  subtitle?: string;
  amountMinor: number;
  dueDate: string;
  isOverdue: boolean;
  icon: string;
  direction: 'in' | 'out';
}

export interface InsightDto {
  id: string;
  /** Purely descriptive — never advice (§49). */
  text: string;
  tone: 'positive' | 'negative' | 'neutral';
  icon: string;
}

// ─────────────────────────────────────────────── Budgets & goals

export interface BudgetDto {
  id: string;
  workspaceId: string;
  categoryId: string | null;
  categoryName?: string;
  name: string;
  amountMinor: number;
  period: 'monthly' | 'weekly' | 'yearly';
  startDate: string;
  endDate?: string;
  rollover: boolean;
  alertThresholds: number[];
  isActive: boolean;
}

export interface BudgetProgressDto extends BudgetDto {
  spentMinor: number;
  remainingMinor: number;
  percentUsed: number;
  status: 'safe' | 'warning' | 'critical' | 'exceeded';
  daysRemaining: number;
  /** Spend per remaining day that would keep the budget intact. */
  safeDailyMinor: number;
}

export interface SavingsGoalDto {
  id: string;
  workspaceId: string;
  name: string;
  targetMinor: number;
  currentMinor: number;
  targetDate?: string;
  icon: string;
  color: string;
  linkedAccountId?: string;
  notes?: string;
  isAchieved: boolean;
  achievedAt?: string;
  createdAt: string;
}

export interface GoalProgressDto extends SavingsGoalDto {
  percentComplete: number;
  remainingMinor: number;
  daysRemaining?: number;
  requiredMonthlyMinor?: number;
}

// ─────────────────────────────────────────────── Recurring & reminders

export interface RecurringTransactionDto {
  id: string;
  workspaceId: string;
  name: string;
  type: TransactionType;
  amountMinor: number;
  accountId: string;
  accountName?: string;
  toAccountId?: string;
  categoryId?: string;
  categoryName?: string;
  personId?: string;
  description: string;
  frequency: RecurrenceFrequency;
  /** For `custom`: repeat every N days. */
  intervalDays?: number;
  /** For `weekly`: 0–6. For `monthly`/`yearly`: day of month. */
  dayOfWeek?: number;
  dayOfMonth?: number;
  monthOfYear?: number;
  startDate: string;
  endDate?: string;
  nextRunDate: string;
  lastRunDate?: string;
  /** Post automatically, or only raise a reminder to confirm. */
  autoPost: boolean;
  reminderDaysBefore: number;
  isActive: boolean;
  occurrencesCreated: number;
  maxOccurrences?: number;
}

export interface ReminderDto {
  id: string;
  workspaceId: string;
  type: ReminderType;
  title: string;
  amountMinor?: number;
  dueDate: string;
  personId?: string;
  personName?: string;
  transactionId?: string;
  recurringId?: string;
  notes?: string;
  isDone: boolean;
  completedAt?: string;
  notifyDaysBefore: number;
}

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  icon: string;
  link?: string;
  isRead: boolean;
  createdAt: string;
}

// ─────────────────────────────────────────────── Petty cash & closings

export interface PettyCashDto {
  id: string;
  workspaceId: string;
  accountId: string;
  accountName?: string;
  /** The imprest float this account is topped back up to (§22). */
  imprestMinor: number;
  currentMinor: number;
  spentSinceReplenishMinor: number;
  replenishDueMinor: number;
  custodian?: string;
  lastReplenishedAt?: string;
  isActive: boolean;
}

export interface DayClosingDto {
  id: string;
  workspaceId: string;
  date: string;
  openingCashMinor: number;
  cashReceivedMinor: number;
  cashPaidMinor: number;
  expectedClosingMinor: number;
  actualClosingMinor: number;
  differenceMinor: number;
  /** Set when the user posts an adjustment for the difference. */
  adjustmentTransactionId?: string;
  note?: string;
  closedAt: string;
  closedBy: string;
}

export interface MonthClosingDto {
  id: string;
  workspaceId: string;
  year: number;
  month: number;
  openingBalanceMinor: number;
  totalReceiptsMinor: number;
  totalPaymentsMinor: number;
  closingBalanceMinor: number;
  incomeMinor: number;
  expenseMinor: number;
  transfersMinor: number;
  receivablesMinor: number;
  payablesMinor: number;
  closedAt: string;
}

// ─────────────────────────────────────────────── Reports

export interface NetWorthDto {
  assetsMinor: number;
  liabilitiesMinor: number;
  netWorthMinor: number;
  breakdown: {
    cashMinor: number;
    bankMinor: number;
    savingsMinor: number;
    investmentMinor: number;
    receivablesMinor: number;
    creditCardMinor: number;
    borrowingsMinor: number;
    payablesMinor: number;
  };
  history: Array<{ date: string; netWorthMinor: number; assetsMinor: number; liabilitiesMinor: number }>;
}

export interface CategoryReportRowDto {
  categoryId: string | null;
  name: string;
  icon: string;
  color: string;
  amountMinor: number;
  count: number;
  percentOfTotal: number;
  previousAmountMinor: number;
  changePercent: number;
}

// ─────────────────────────────────────────────── Audit

export interface AuditLogDto {
  id: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  summary: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ipAddress?: string;
  createdAt: string;
}
