import type { CurrencyCode } from '../../types/money.js';

import type {
  SAVINGS_GOAL_CONTRIBUTION_STATUSES,
  SAVINGS_GOAL_STATUSES,
} from './savings-goal.constants.js';

export type SavingsGoalStatus = (typeof SAVINGS_GOAL_STATUSES)[number];

export type SavingsGoalContributionStatus =
  (typeof SAVINGS_GOAL_CONTRIBUTION_STATUSES)[number];

// =======================================================
// SAVINGS GOALS
// =======================================================

export interface SavingsGoalParams {
  goalId: string;
}


export interface ListSavingsGoalsQuery {
  status?: SavingsGoalStatus;
  limit?: number;
  offset?: number;
}

export interface SavingsGoalRow {
  id: string;
  name: string;
  description: string | null;

  targetAmount: string;
  currencyCode: CurrencyCode;
  targetDate: string | null;

  status: SavingsGoalStatus;

  contributedAmount: string;
  remainingAmount: string;
  progressPercentage: string;
  contributionCount: number;

  createdAt: Date;
  updatedAt: Date;
}

export interface SavingsGoalsListResult {
  data: SavingsGoalRow[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
}

export interface UpdateSavingsGoalParams {
  name: string;
  description: string | null;
  targetAmount: number;
  currencyCode: CurrencyCode;
  targetDate: string | null;
  status: SavingsGoalRow['status'];
}

export interface CreateSavingsGoalBody {
  name: string;
  description?: string | null;
  targetAmount: number;
  currencyCode: CurrencyCode;
  targetDate?: string | null;
}

export interface UpdateSavingsGoalBody {
  name?: string;
  description?: string | null;
  targetAmount?: number;
  currencyCode?: CurrencyCode;
  targetDate?: string | null;
  status?: SavingsGoalStatus;
}

export interface SavingsGoalForUpdateRow {
  id: string;
  household_id: string;

  name: string;
  description: string | null;

  target_amount: string;
  currency_code: CurrencyCode;
  target_date: string | null;

  status: SavingsGoalStatus;

  created_at: Date;
  updated_at: Date;
}

// =======================================================
// SAVINGS GOAL CONTRIBUTIONS
// =======================================================

export interface SavingsGoalContributionParams {
  goalId: string;
  contributionId: string;
}

export interface ListSavingsGoalContributionsQuery {
  status?: SavingsGoalContributionStatus;
  limit?: number;
  offset?: number;
}

export interface SavingsGoalContributionRow {
  id: string;
  goalId: string;

  transactionId: string | null;

  amount: string;
  currencyCode: CurrencyCode;

  contributedAt: Date;
  notes: string | null;

  status: SavingsGoalContributionStatus;

  voidedAt: Date | null;
  voidedBy: string | null;
  voidReason: string | null;

  sourceAccountId: string | null;
  sourceAccountName: string | null;
  sourceAmount: string | null;
  sourceCurrencyCode: CurrencyCode | null;

  destinationAccountId: string | null;
  destinationAccountName: string | null;

  transactionOccurredAt: Date | null;
}

export interface SavingsGoalContributionsListResult {
  data: SavingsGoalContributionRow[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
}

export interface CreateSavingsGoalContributionBody {
  sourceAccountId: string;
  destinationAccountId: string;

  // Amount received by the destination account,
  // expressed in the savings goal currency.
  amount: number;

  // Amount debited from the source account.
  // Required when source and destination currencies differ.
  sourceAmount?: number;

  // Source account conversion to household base currency.
  exchangeRateToBase?: number;

  // Destination account conversion to household base currency.
  transferExchangeRateToBase?: number;

  occurredAt?: string;
  notes?: string | null;
}

export interface VoidSavingsGoalContributionBody {
  reason: string;
}

// =======================================================
// DATABASE ROWS
// =======================================================

export interface SavingsGoalAccountRow {
  id: string;
  name: string;
  account_type: string;
  currency_code: CurrencyCode;
  is_active: boolean;
}

export interface SavingsGoalContributionForUpdateRow {
  id: string;
  goal_id: string;
  transaction_id: string | null;

  amount: string;
  currency_code: CurrencyCode;

  contributed_at: Date;
  notes: string | null;

  status: SavingsGoalContributionStatus;

  voided_at: Date | null;
  voided_by: string | null;
  void_reason: string | null;
}

export interface SavingsGoalBaseCurrencyRow {
  base_currency_code: CurrencyCode;
}

export interface CreatedSavingsGoalContributionRow {
  id: string;
  goal_id: string;
  transaction_id: string;

  amount: string;
  currency_code: CurrencyCode;

  contributed_at: Date;
  notes: string | null;

  status: SavingsGoalContributionStatus;

  created_at: Date;
}
