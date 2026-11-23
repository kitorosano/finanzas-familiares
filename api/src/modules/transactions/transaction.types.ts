import type { CurrencyCode } from '../../types/money.js';
import type { CategoryType } from '../categories/category.types.js';
import type {
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
} from './transaction.constants.js';

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

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
