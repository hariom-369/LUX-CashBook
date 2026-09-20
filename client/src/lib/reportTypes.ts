/**
 * Report response shapes that don't warrant a place in `@khata/shared` because
 * they are read-only view models, not domain entities other modules construct.
 */

export interface MonthSummaryRow {
  year: number;
  month: number;
  label: string;
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
  transferMinor: number;
}

export interface BorrowLendRow {
  personId: string;
  personName: string;
  totalLentMinor: number;
  totalBorrowedMinor: number;
  totalRepaidToYouMinor: number;
  totalRepaidByYouMinor: number;
  outstandingMinor: number;
  status: 'receivable' | 'payable' | 'settled';
}
