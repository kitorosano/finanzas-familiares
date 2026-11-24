import type { CurrencyCode } from '../../types/money.js';
import type { AccountType } from '../accounts/account.types.js';
import type { CategoryType } from '../categories/category.types.js';

import type {
  TRANSACTION_QUERY_STATUSES,
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
} from './transaction.constants.js';

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export type TransactionQueryStatus =
  (typeof TRANSACTION_QUERY_STATUSES)[number];

export interface CreatedPurchaseRow {
  purchase_id: string;
}

export interface CreateTransactionResult {
  transaction: TransactionRow;
  creditCardPurchaseId: string | null;
}

export interface CreateTransactionBase {
  accountId: string;
  amount: number;
  occurredAt?: string;
  description?: string | null;
  notes?: string | null;
  status?: TransactionStatus;
  exchangeRateToBase?: number;
}

export interface CreateIncomeExpenseBody extends CreateTransactionBase {
  transactionType: CategoryType;
  categoryId: string;
  installmentsCount?: number;
}

export interface CreateTransferBody extends CreateTransactionBase {
  transactionType: 'transfer';
  transferAccountId: string;
  transferAmount: number;
  transferExchangeRateToBase?: number;
}

export type CreateTransactionBody =
  | CreateIncomeExpenseBody
  | CreateTransferBody;

export interface ListTransactionsQuery {
  accountId?: string;
  categoryId?: string;
  transactionType?: TransactionType;
  status?: TransactionQueryStatus;
  occurredFrom?: string;
  occurredTo?: string;
  limit?: number;
  offset?: number;
}

export interface TransactionQueryRow {
  id: string;

  transactionType: TransactionType;
  status: TransactionQueryStatus;
  occurredAt: Date;
  voidedAt: Date | null;

  description: string | null;
  amount: string;
  currencyCode: CurrencyCode;
  exchangeRateToBase: string;
  amountBase: string;

  accountId: string;
  accountName: string;
  accountType: AccountType;

  categoryId: string | null;
  categoryName: string | null;
  categoryType: CategoryType | null;

  transferAccountId: string | null;
  transferAccountName: string | null;
  transferAmount: string | null;
  transferCurrencyCode: CurrencyCode | null;
  transferExchangeRateToBase: string | null;
  transferAmountBase: string | null;

  creditCardPurchaseId: string | null;
  installmentsCount: number | null;
  firstDueDate: string | null;

  notes: string | null;

  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TransactionsListResult {
  data: TransactionQueryRow[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
}

export interface InsertTransactionParams {
  householdId: string;
  transactionType: TransactionType;
  status: TransactionStatus;
  occurredAt: string | null;
  description: string | null;
  amount: number;
  currencyCode: CurrencyCode;
  exchangeRateToBase: number;
  accountId: string;
  categoryId: string | null;
  transferAccountId: string | null;
  transferAmount: number | null;
  transferCurrencyCode: CurrencyCode | null;
  transferExchangeRateToBase: number | null;
  notes: string | null;
  userId: string;
}

export interface TransactionRow {
  id: string;
  transaction_type: TransactionType;
  status: TransactionStatus;
  occurred_at: Date;
  description: string | null;
  amount: string;
  currency_code: CurrencyCode;
  exchange_rate_to_base: string;
  amount_base: string;
  account_id: string;
  category_id: string | null;
  transfer_account_id: string | null;
  transfer_amount: string | null;
  transfer_currency_code: CurrencyCode | null;
  transfer_exchange_rate_to_base: string | null;
  transfer_amount_base: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: Date;
}

export interface UpdateTransactionBody {
  accountId?: string;
  amount?: number;
  occurredAt?: string;
  description?: string | null;
  notes?: string | null;
  status?: TransactionStatus;
  exchangeRateToBase?: number;

  categoryId?: string;

  transferAccountId?: string;
  transferAmount?: number;
  transferExchangeRateToBase?: number;
}

export interface TransactionForUpdateRow {
  id: string;

  transaction_type: TransactionType;
  status: TransactionQueryStatus;
  occurred_at: Date;
  voided_at: Date | null;

  description: string | null;
  amount: string;
  currency_code: CurrencyCode;
  exchange_rate_to_base: string;
  amount_base: string;

  account_id: string;
  category_id: string | null;

  transfer_account_id: string | null;
  transfer_amount: string | null;
  transfer_currency_code: CurrencyCode | null;
  transfer_exchange_rate_to_base: string | null;
  transfer_amount_base: string | null;

  notes: string | null;

  account_type: AccountType;
  transfer_account_type: AccountType | null;

  has_credit_card_purchase: boolean;
  has_card_payment_allocations: boolean;
  has_savings_goal_contribution: boolean;
}

export interface VoidTransactionBody {
  reason: string;
}
