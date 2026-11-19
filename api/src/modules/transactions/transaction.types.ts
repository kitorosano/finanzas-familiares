export type TransactionType = 'income' | 'expense' | 'transfer';

export type TransactionStatus = 'pending' | 'posted';

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
  transactionType: 'income' | 'expense';
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
  currency_code: string;
  exchange_rate_to_base: string;
  amount_base: string;
  account_id: string;
  category_id: string | null;
  transfer_account_id: string | null;
  transfer_amount: string | null;
  transfer_currency_code: string | null;
  transfer_exchange_rate_to_base: string | null;
  transfer_amount_base: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: Date;
}
