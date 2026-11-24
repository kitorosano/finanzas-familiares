import type { CurrencyCode } from '../../types/money.js';
import { BUDGET_CONVERSION_STATUSES } from './budget.constants.js';

export type BudgetConversionStatus =
  (typeof BUDGET_CONVERSION_STATUSES)[number];

export interface BudgetParams {
  budgetId: string;
}

export interface ListBudgetsQuery {
  categoryId?: string;
  includeInactive?: boolean;
  periodFrom?: string;
  periodTo?: string;
  limit?: number;
  offset?: number;
}

export interface BudgetRow {
  id: string;
  name: string | null;

  categoryId: string;
  categoryName: string;

  periodStart: string;
  periodEnd: string;

  amount: string;
  currencyCode: CurrencyCode;

  exchangeRateToBase: string | null;
  amountBase: string | null;
  baseCurrencyCode: CurrencyCode;

  spentAmountBase: string;
  remainingAmountBase: string | null;
  executionPercentage: string | null;
  conversionStatus: BudgetConversionStatus;

  notes: string | null;
  isActive: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export interface BudgetsListResult {
  data: BudgetRow[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
}

export interface CreateBudgetBody {
  name?: string | null;
  categoryId: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  currencyCode: CurrencyCode;
  exchangeRateToBase?: number;
  notes?: string | null;
}

export interface UpdateBudgetParams {
  categoryId: string;
  name: string | null;

  periodStart: string;
  periodEnd: string;

  amount: number;
  currencyCode: CurrencyCode;
  exchangeRateToBase: number | null;

  notes: string | null;
  isActive: boolean;
}

export interface UpdateBudgetBody {
  name?: string | null;
  categoryId?: string;
  periodStart?: string;
  periodEnd?: string;
  amount?: number;
  currencyCode?: CurrencyCode;
  exchangeRateToBase?: number;
  notes?: string | null;
  isActive?: boolean;
}

export interface BudgetForUpdateRow {
  id: string;
  name: string | null;

  household_id: string;
  category_id: string;

  period_start: string;
  period_end: string;

  amount: string;
  currency_code: CurrencyCode;

  exchange_rate_to_base: string | null;
  amount_base: string | null;
  base_currency_code: CurrencyCode;

  notes: string | null;
  is_active: boolean;

  created_at: Date;
  updated_at: Date;
}
