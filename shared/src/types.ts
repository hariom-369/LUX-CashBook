/**
 * API contract types.
 *
 * These describe what crosses the wire — the JSON the server sends and the client
 * consumes. They deliberately do *not* mirror the Mongoose documents: `_id` is
 * always serialised as `id`, dates are always ISO strings, and internal fields
 * (password hashes, token families) never appear here at all.
 */

import type {
  AccountType, AccountVisibility, AuditAction, BillKind, CategoryKind, DateFormat, DocumentType, GroupSplitMethod,
  IndianState, InvoiceStatus, NotificationType, PaymentMethod, PersonRelationship, PriceType, ProjectStatus,
  QuotationStatus, RecurrenceFrequency, ReimbursementStatus, ReminderType, StockMovementType, Theme, TransactionType, WorkspaceMode,
  WorkspaceRole,
} from './constants.js';
import type { RangePreset } from './date.js';

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
  /** Opt-in consent (§Phase 10, decision 7) — the AI assistant sends transaction/budget data to an external model only once this is explicitly turned on. */
  aiAssistantEnabled: boolean;
  /** Which screen opens first (§Phase 2). 'daily' is the simplified Daily Money view; the full dashboard is always one tap away. Absent on older accounts = 'dashboard'. */
  homeScreen?: 'dashboard' | 'daily';
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
    /**
     * How many digits the app-lock PIN has, so the lock screen knows when entry is
     * complete. Set by the server when a PIN is saved; null for a PIN saved before
     * this was recorded (the lock screen then asks the user to confirm entry).
     */
    pinLength?: number | null;
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
  /** Household workspaces (Phase 9) — the caller's own role and how many members share this workspace. A solo workspace is `myRole: 'owner'`, `memberCount: 1`. */
  myRole: WorkspaceRole;
  memberCount: number;
  /** Business profile — shown on generated statements and invoice PDFs. */
  businessName?: string;
  businessAddress?: string;
  gstin?: string;
  logoUrl?: string;
  /** This business's own state (§Phase 13) — compared against a customer's state to decide intra- vs inter-state GST (CGST+SGST vs IGST). */
  state?: IndianState;
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────── Account

export interface AccountDto {
  id: string;
  /** Edit revision — send back on update; a mismatch means someone else changed it first. */
  rev: number;
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
  /** Credit cards only (Phase 7). */
  statementDay?: number;
  dueDay?: number;
  minimumDueMinor?: number;
  excludeFromTotals: boolean;
  /** Household workspaces (Phase 9): a `private` account is invisible to every other member. */
  visibility: AccountVisibility;
  notes?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CardSummaryDto {
  outstandingMinor: number;
  creditLimitMinor?: number;
  utilizationPercent?: number;
  statementDay?: number;
  dueDay?: number;
  minimumDueMinor?: number;
  nextDueDate?: string;
  daysUntilDue?: number;
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
  /** Edit revision — send back on update; a mismatch means someone else changed it first. */
  rev: number;
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
  /** §Phase 13 — a customer/supplier's own GST registration, if any. */
  gstin?: string;
  state?: IndianState;
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

export interface InstallmentDto {
  dueDate: string;
  amountMinor: number;
  /** `paid` once cumulative repayments reach this installment's cumulative total — never stored, always derived from the loan's real `settledMinor`. */
  status: 'paid' | 'overdue' | 'upcoming';
}

export interface InstallmentPlanDto {
  id: string;
  transactionId: string;
  installments: InstallmentDto[];
}

export interface LoanTimelineEntryDto {
  loan: TransactionDto;
  /** `repayment_given`/`repayment_received` rows linked to this loan, oldest first. */
  repayments: TransactionDto[];
  remainingMinor: number;
  installmentPlan?: InstallmentPlanDto;
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
  /** Vault fields (Phase 6) — set when this was uploaded as a standalone document, not just a transaction receipt. */
  docType?: DocumentType;
  title?: string;
  expiryDate?: string;
  tags?: string[];
  amountMinor?: number;
  transactionId?: string;
  accountId?: string;
  deletedAt?: string | null;
}

export interface TransactionDto {
  id: string;
  /** Edit revision — send back on update; a mismatch means someone else changed it first. */
  rev: number;
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
  payeeId?: string;
  payeeName?: string;
  /** Billable expense attribution (§Phase 11) — which project this transaction counts against, if any. */
  projectId?: string;
  projectName?: string;
  description: string;
  /** Set on an expense being tracked for reimbursement (§Phase 7). */
  reimbursement?: ReimbursementDto;
  /** True when this entry is a transfer with another member's private account: only the shared leg is shown. */
  isMasked?: boolean;
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
  /** Set once a bank-import row is matched/confirmed against this transaction (Phase 5). */
  reconciledAt?: string;
  statementRef?: string;
  /** Shared by every part of one split payment (Phase 8). */
  splitGroupId?: string;
  /** Set on the expense/lend rows a group expense created. */
  groupExpenseId?: string;
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

// ─────────────────────────────────────────────── Bank import & reconciliation

export const IMPORT_DATE_FORMATS = ['dd/mm/yyyy', 'mm/dd/yyyy', 'yyyy-mm-dd', 'dd-mm-yyyy'] as const;
export type ImportDateFormat = (typeof IMPORT_DATE_FORMATS)[number];

/** Which raw CSV column feeds which concept — saved per bank so re-importing a statement never asks twice. */
export interface ImportColumnMapping {
  date: string;
  description: string;
  /** Either a single signed `amount` column, or separate `debit`/`credit` columns — never both. */
  amount?: string;
  debit?: string;
  credit?: string;
  reference?: string;
}

export interface ImportProfileDto {
  id: string;
  name: string;
  dateFormat: ImportDateFormat;
  mapping: ImportColumnMapping;
  defaultAccountId?: string;
  createdAt: string;
}

export type BankImportRowStatus = 'new' | 'duplicate' | 'possible_duplicate' | 'invalid';

export interface BankImportRow {
  /** Index into the originally uploaded CSV — stable across preview and commit. */
  rowNumber: number;
  raw: Record<string, string>;
  date?: string;
  description?: string;
  /** Signed: positive is money in, negative is money out. */
  amountMinor?: number;
  reference?: string;
  status: BankImportRowStatus;
  /** Populated for `duplicate`/`possible_duplicate` — the existing transaction it matches. */
  matchedTransactionId?: string;
  matchReason?: string;
  errors: string[];
}

export interface BankImportPreviewDto {
  rows: BankImportRow[];
  counts: Record<BankImportRowStatus, number>;
}

export interface BankImportCommitResultDto {
  imported: number;
  matched: number;
  skipped: number;
  importBatchId: string;
}

export interface AccountReconcilePreviewDto {
  ledgerBalanceMinor: number;
  statementBalanceMinor: number;
  differenceMinor: number;
}

export interface AccountReconcileResultDto {
  differenceMinor: number;
  adjustmentTransactionId?: string;
  reconciledAt: string;
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
  /** The first day the bucket covers, `yyyy-MM-dd` - lets the client write the label in the user's own language. */
  start?: string;
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
  /** Edit revision — send back on update; a mismatch means someone else changed it first. */
  rev: number;
  workspaceId: string;
  categoryId: string | null;
  categoryName?: string;
  /** Optional (Phase 7) — scopes this budget to spending on one account only. */
  accountId?: string | null;
  accountName?: string;
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
  /** Linear projection of full-period spend from the rate so far (Phase 7) — always labelled as an estimate. */
  projectedSpendMinor: number;
}

export interface BudgetSuggestionDto {
  categoryId: string;
  categoryName: string;
  lastMonthSpentMinor: number;
}

export interface CashFlowForecastPoint {
  date: string;
  projectedBalanceMinor: number;
}

export interface CashFlowForecastDto {
  asOf: string;
  startingBalanceMinor: number;
  days: number;
  points: CashFlowForecastPoint[];
  /** Always true — a forecast is never mixed into an actual balance anywhere it's shown. */
  isEstimate: true;
}

export interface SavingsGoalDto {
  id: string;
  /** Edit revision — send back on update; a mismatch means someone else changed it first. */
  rev: number;
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
  /** `no_deadline` when there's no target date to pace against (Phase 7). */
  status: 'achieved' | 'ahead' | 'on_track' | 'behind' | 'no_deadline';
}

// ─────────────────────────────────────────────── Recurring & reminders

export interface RecurringTransactionDto {
  id: string;
  /** Edit revision — send back on update; a mismatch means someone else changed it first. */
  rev: number;
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
  payeeId?: string;
  payeeName?: string;
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
  billKind?: BillKind;
}

export interface PushSubscriptionDto {
  id: string;
  createdAt: string;
}

export interface SubscriptionSuggestionDto {
  /** Stable identity for this detected pattern — dismiss/create reference it. */
  signature: string;
  payeeId?: string;
  payeeName?: string;
  description: string;
  amountMinor: number;
  accountId: string;
  accountName?: string;
  categoryId?: string;
  categoryName?: string;
  frequency: RecurrenceFrequency;
  occurrenceCount: number;
  lastDate: string;
  nextExpectedDate: string;
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

/**
 * One entry in a user's own security history (Settings → Security): sign-ins,
 * password changes, PIN changes, signing out everywhere. Never carries secrets.
 */
export interface SecurityEventDto {
  id: string;
  action: AuditAction;
  summary: string;
  createdAt: string;
  ipAddress?: string;
  userAgent?: string;
}

// ─────────────────────────────────────────────── Payees

export interface PayeeDto {
  id: string;
  workspaceId: string;
  name: string;
  defaultAccountId?: string;
  defaultCategoryId?: string;
  notes?: string;
  tags: string[];
  isArchived: boolean;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────── Splits & groups (Phase 8)

export interface SplitPartInput {
  categoryId: string | null;
  amountMinor: number;
  description?: string;
}

export interface ExpenseGroupDto {
  id: string;
  workspaceId: string;
  name: string;
  memberPersonIds: string[];
  memberNames: string[];
  isActive: boolean;
  createdAt: string;
}

export interface GroupExpenseMemberShareDto {
  personId: string;
  personName?: string;
  amountMinor: number;
  /** The `lend` transaction this member's share posted as, if their share was greater than zero. */
  transactionId?: string;
}

export interface GroupExpenseDto {
  id: string;
  groupId: string;
  description: string;
  date: string;
  totalAmountMinor: number;
  accountId: string;
  accountName?: string;
  categoryId?: string;
  categoryName?: string;
  splitMethod: GroupSplitMethod;
  mySplitMinor: number;
  myExpenseTransactionId?: string;
  memberShares: GroupExpenseMemberShareDto[];
  createdAt: string;
}

export interface GroupMemberBalanceDto {
  personId: string;
  personName: string;
  /** Outstanding across every expense in this group — positive means they still owe you. */
  outstandingMinor: number;
}

// ─────────────────────────────────────────────── Household workspaces (Phase 9)

export interface WorkspaceMemberDto {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  joinedAt: string;
}

export interface InvitationDto {
  id: string;
  email: string;
  role: WorkspaceRole;
  invitedByName?: string;
  expiresAt: string;
  createdAt: string;
}

// ─────────────────────────────────────────────── AI assistant (Phase 10)

export interface AiStatusDto {
  /** The server has a provider key configured. */
  configured: boolean;
  /** This user has opted in (preferences.aiAssistantEnabled). */
  consentGiven: boolean;
}

export interface TransactionDraftDto {
  type: 'expense' | 'income';
  amountMinor: number;
  description: string;
  date: string;
  categoryId: string | null;
  categoryName: string | null;
  accountId: string | null;
  accountName: string | null;
  matched: { category: boolean; account: boolean };
}

// ─────────────────────────────────────────────── Invoicing (Phase 11)

export interface LineItemDto {
  description: string;
  quantity: number;
  rateMinor: number;
  /** `quantity * rateMinor`, rounded — stored rather than recomputed so an edit to a later field never silently reflows a saved line. */
  amountMinor: number;
  /** §Phase 13 — HSN (goods) or SAC (services) code, entered per line since items aren't linked to a `Product`. */
  hsnCode?: string;
}

/** §Phase 13 — the CGST+SGST vs IGST split, computed once from the workspace's and the customer's state and frozen at that point, never recomputed if either state changes later. */
export interface GstBreakdownDto {
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
}

export interface InvoiceDto {
  id: string;
  rev: number;
  workspaceId: string;
  number: string;
  /** Includes the derived `overdue` value — see `INVOICE_STORED_STATUSES` for what's actually persisted. */
  status: InvoiceStatus;
  personId: string;
  personName?: string;
  projectId?: string;
  projectName?: string;
  issueDate: string;
  dueDate: string;
  items: LineItemDto[];
  subtotalMinor: number;
  discountMinor: number;
  taxPercent: number;
  taxMinor: number;
  totalMinor: number;
  /** §Phase 13 */
  priceType: PriceType;
  placeOfSupplyState?: IndianState;
  gst?: GstBreakdownDto;
  notes?: string;
  accountId?: string;
  paidTransactionId?: string;
  paidAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuotationDto {
  id: string;
  rev: number;
  workspaceId: string;
  number: string;
  status: QuotationStatus;
  personId: string;
  personName?: string;
  projectId?: string;
  projectName?: string;
  issueDate: string;
  expiryDate: string;
  items: LineItemDto[];
  subtotalMinor: number;
  discountMinor: number;
  taxPercent: number;
  taxMinor: number;
  totalMinor: number;
  priceType: PriceType;
  placeOfSupplyState?: IndianState;
  gst?: GstBreakdownDto;
  notes?: string;
  convertedInvoiceId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDto {
  id: string;
  rev: number;
  workspaceId: string;
  name: string;
  personId?: string;
  personName?: string;
  status: ProjectStatus;
  budgetMinor?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StatementRowDto {
  categoryId: string | null;
  categoryName: string;
  amountMinor: number;
  count: number;
}

export interface ProfitAndLossDto {
  from: string;
  to: string;
  income: { rows: StatementRowDto[]; totalMinor: number };
  expense: { rows: StatementRowDto[]; totalMinor: number };
  netProfitMinor: number;
}

export const AGEING_BUCKETS = ['not_due', '0_30', '31_60', '61_90', 'over_90'] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

export interface AgeingRowDto {
  personId: string;
  personName: string;
  source: 'invoice' | 'loan';
  referenceId: string;
  referenceLabel: string;
  dueDate: string;
  daysPastDue: number;
  bucket: AgeingBucket;
  amountMinor: number;
}

export interface AgeingReportDto {
  asOf: string;
  direction: 'receivable' | 'payable';
  rows: AgeingRowDto[];
  totalsByBucket: Record<AgeingBucket, number>;
  totalMinor: number;
}

export interface ProjectSummaryDto {
  project: ProjectDto;
  /** Total of this project's `paid` invoices. */
  billedMinor: number;
  /** Total of transactions (type `expense`) attributed to this project. */
  expenseMinor: number;
  profitMinor: number;
  invoiceCount: number;
  openInvoiceCount: number;
}

// ─────────────────────────────────────────────── Inventory (Phase 12)

export interface ProductDto {
  id: string;
  rev: number;
  workspaceId: string;
  name: string;
  sku: string;
  unitPriceMinor: number;
  costPriceMinor?: number;
  stockQty: number;
  lowStockThreshold: number;
  isLowStock: boolean;
  isActive: boolean;
  /** §Phase 13 — HSN (goods) or SAC (services) code. */
  hsnCode?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StockMovementDto {
  id: string;
  productId: string;
  type: StockMovementType;
  quantity: number;
  note?: string;
  date: string;
  createdAt: string;
}

// ─────────────────────────────────────────────── Petty cash 2.0 (Phase 12)

export interface PettyCashCountDto {
  id: string;
  pettyCashId: string;
  date: string;
  expectedMinor: number;
  countedMinor: number;
  differenceMinor: number;
  note?: string;
  countedAt: string;
}

export interface PettyCashDailyReportDto {
  pettyCash: PettyCashDto;
  /** Spend by category since the last replenishment. */
  spendByCategory: StatementRowDto[];
  recentCounts: PettyCashCountDto[];
}

// ─────────────────────────────────────────────── GST summary (Phase 13)

export interface GstSummaryRowDto {
  taxPercent: number;
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  invoiceCount: number;
}

export interface GstSummaryDto {
  from: string;
  to: string;
  rows: GstSummaryRowDto[];
  totalTaxableMinor: number;
  totalCgstMinor: number;
  totalSgstMinor: number;
  totalIgstMinor: number;
}

// ─────────────────────────────────────────────── Tags (§Phase 2)

/** One tag across the workspace's transactions, as the viewer is allowed to see them. */
export interface TagSummaryDto {
  tag: string;
  transactionCount: number;
  incomeMinor: number;
  expenseMinor: number;
  lastUsedAt?: string;
}

// ─────────────────────────────────────────────── Category rules (§Phase 2)

export interface CategoryRuleDto {
  id: string;
  /** Lowercase text looked for in the description (or payee name). */
  pattern: string;
  field: 'description' | 'payee';
  categoryId: string;
  categoryName?: string;
  kind: 'income' | 'expense';
  /** How many times a suggestion from this rule was accepted. */
  hits: number;
  lastUsedAt?: string;
}

/** What the entry form shows next to the category field - an offer, never an applied value. */
export interface CategorySuggestionDto {
  ruleId: string;
  categoryId: string;
  categoryName: string;
  pattern: string;
  /** `high`: a rule the user has accepted several times and that matches a whole word. `medium`: anything else. */
  confidence: 'high' | 'medium';
}

// ─────────────────────────────────────────────── Reimbursements (§Phase 7)

export interface ReimbursementDto {
  status: ReimbursementStatus;
  /** The income entry the money arrived as - set once the claim is `paid`. */
  payoutTransactionId?: string;
  updatedAt: string;
}

export interface ReimbursementSummaryDto {
  /** Per status: how many expenses and how much they add up to. */
  byStatus: Array<{ status: ReimbursementStatus; count: number; amountMinor: number }>;
  /** Everything not yet `paid` - what is still owed to you. */
  outstandingMinor: number;
}

// ─────────────────────────────────────────────── Report builder (§Phase 7)

export type ReportGroupBy = 'category' | 'account' | 'payee' | 'person' | 'tag' | 'month' | 'day' | 'type';

/** A report-builder query. Every field is an allow-listed filter or grouping; the server rejects anything else. */
export interface ReportDefinition {
  range: RangePreset;
  from?: string | Date;
  to?: string | Date;
  types?: Array<'income' | 'expense'>;
  accountIds?: string[];
  categoryIds?: string[];
  personIds?: string[];
  payeeIds?: string[];
  tags?: string[];
  minAmountMinor?: number;
  maxAmountMinor?: number;
  groupBy: ReportGroupBy;
  /** How the client shows it - a table, a chart or a one-line summary. Does not change the data. */
  view: 'table' | 'chart' | 'summary';
}

export interface ReportResultRowDto {
  key: string;
  label: string;
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
  count: number;
}

export interface ReportResultDto {
  definition: ReportDefinition;
  from: string;
  to: string;
  rows: ReportResultRowDto[];
  totals: { incomeMinor: number; expenseMinor: number; netMinor: number; count: number };
  /** True when grouped by tag: an entry with several tags appears under each, so rows do not add up to the totals. */
  overlapping: boolean;
  /** True when more groups exist than were returned. */
  truncated: boolean;
}

export interface SavedReportDto {
  id: string;
  name: string;
  definition: ReportDefinition;
  updatedAt: string;
}
