import type { CurrencyCode } from '../../types/money.js';
import type { AccountType } from '../accounts/account.types.js';
import type { CategoryType } from '../categories/category.types.js';

import type {
  RECURRING_TRANSACTION_FREQUENCIES,
  RECURRING_TRANSACTION_TYPES,
} from './recurring-transaction.constants.js';

export type RecurringTransactionType =
  (typeof RECURRING_TRANSACTION_TYPES)[number];

export type RecurringTransactionFrequency =
  (typeof RECURRING_TRANSACTION_FREQUENCIES)[number];

export interface RecurringTransactionParams {
  recurringTransactionId: string;
}

export interface ListRecurringTransactionsQuery {
  accountId?: string;
  categoryId?: string;
  transactionType?: RecurringTransactionType;
  frequency?: RecurringTransactionFrequency;
  includeInactive?: boolean;
  nextOccurrenceFrom?: string;
  nextOccurrenceTo?: string;
  limit?: number;
  offset?: number;
}

export interface RecurringTransactionRow {
  id: string;

  transactionType: RecurringTransactionType;
  description: string;
  amount: string;
  currencyCode: CurrencyCode;

  accountId: string;
  accountName: string;
  accountType: AccountType;

  categoryId: string;
  categoryName: string;
  categoryType: CategoryType;

  frequency: RecurringTransactionFrequency;
  intervalValue: number;

  startDate: string;
  endDate: string | null;
  nextOccurrence: string;

  isActive: boolean;

  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecurringTransactionsListResult {
  data: RecurringTransactionRow[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
}

export interface CreateRecurringTransactionBody {
  transactionType: RecurringTransactionType;
  description: string;
  amount: number;

  accountId: string;
  categoryId: string;

  frequency: RecurringTransactionFrequency;
  intervalValue?: number;

  startDate: string;
  endDate?: string | null;
}

export interface UpdateRecurringTransactionBody {
  transactionType?: RecurringTransactionType;
  description?: string;
  amount?: number;

  accountId?: string;
  categoryId?: string;

  frequency?: RecurringTransactionFrequency;
  intervalValue?: number;

  startDate?: string;
  endDate?: string | null;

  isActive?: boolean;
}

export interface UpdateRecurringTransactionParams extends UpdateRecurringTransactionBody {
  transactionType: CreateRecurringTransactionBody['transactionType'];
  description: string;
  amount: number;
  currencyCode: CurrencyCode;

  accountId: string;
  categoryId: string;

  frequency: CreateRecurringTransactionBody['frequency'];
  intervalValue: number;

  startDate: string;
  endDate: string | null;
  nextOccurrence: string;

  isActive: boolean;
}

export interface RecurringTransactionForUpdateRow {
  id: string;
  household_id: string;

  transaction_type: RecurringTransactionType;
  description: string;
  amount: string;
  currency_code: CurrencyCode;

  account_id: string;
  category_id: string;

  frequency: RecurringTransactionFrequency;
  interval_value: number;

  start_date: string;
  end_date: string | null;
  next_occurrence: string;

  is_active: boolean;

  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface RecurringTransactionAccountRow {
  id: string;
  name: string;
  account_type: AccountType;
  currency_code: CurrencyCode;
  is_active: boolean;
}

export interface RecurringTransactionCategoryRow {
  id: string;
  category_type: CategoryType;
  is_active: boolean;
}
