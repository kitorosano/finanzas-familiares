import type { TransactionRow } from '../transactions/transaction.types.js';

export interface PayCreditCardParams {
  cardAccountId: string;
}

export interface PayCreditCardBody {
  sourceAccountId: string;
  amount: number;
  exchangeRateToBase?: number;
  occurredAt?: string;
  notes?: string | null;
}

export interface CreditCardPaymentAllocation {
  statementId: string;
  periodStart: string;
  periodEnd: string;
  closingDate: string;
  dueDate: string;
  amount: string;
}

export interface CreditCardPosition {
  signedBalance: string;
  debtBalance: string;
  creditBalance: string;
  outstandingStatementBalance: string;
  unappliedAdvances: string;
}

export interface CreditCardPaymentResult {
  transaction: TransactionRow;
  allocations: CreditCardPaymentAllocation[];
  allocatedAmount: string;
  unappliedAdvance: string;
  cardPosition: CreditCardPosition;
}

export type CreditCardStatementStatus = 'pending' | 'partially_paid' | 'paid';

export type CreditCardCurrencyCode = 'UYU' | 'USD' | 'ARS' | 'BRL';

export interface ListCreditCardsQuery {
  currencyCode?: CreditCardCurrencyCode;
  includeInactive?: boolean;
}

export interface CreditCardRow {
  id: string;
  name: string;
  institution: string | null;
  currencyCode: CreditCardCurrencyCode;

  holderUserId: string | null;
  holderName: string | null;

  isActive: boolean;
  includeInNetWorth: boolean;
  creditLimit: string | null;

  statementClosingDay: number | null;
  paymentDueDay: number | null;
  paymentDueMonthOffset: number | null;

  balance: string;
  baseCurrencyCode: CreditCardCurrencyCode;
  exchangeRateToBase: string | null;
  balanceBase: string | null;
  conversionStatus:
    | 'base_currency'
    | 'zero_balance'
    | 'converted'
    | 'missing_rate';

  signedBalance: string;
  debtBalance: string;
  creditBalance: string;
  outstandingStatementBalance: string;
  unappliedAdvances: string;
}

export interface ListCreditCardStatementsQuery {
  status?: CreditCardStatementStatus;
  dueFrom?: string;
  dueTo?: string;
  limit?: number;
  offset?: number;
}

export interface CreditCardStatementRow {
  id: string;
  accountId: string;
  periodStart: string;
  periodEnd: string;
  closingDate: string;
  dueDate: string;

  totalDue: string;
  amountPaid: string;
  outstandingAmount: string;
  paymentStatus: CreditCardStatementStatus;

  installmentCount: number;
  paymentCount: number;

  notes: string | null;
  createdAt: Date;
}

export interface CreditCardStatementInstallment {
  id: string;
  purchaseId: string;
  installmentNumber: number;
  dueDate: string;
  amount: string;

  purchaseInstallmentsCount: number;
  purchaseFirstDueDate: string;

  transactionId: string;
  purchaseDescription: string | null;
  purchaseOccurredAt: Date;
  purchaseAmount: string;
  categoryName: string | null;
}

export interface CreditCardStatementPayment {
  id: string;
  transactionId: string;
  amount: string;
  notes: string | null;
  createdAt: Date;

  paymentDescription: string | null;
  paymentOccurredAt: Date;
  transferAmount: string;

  sourceAccountId: string;
  sourceAccountName: string;
}

export interface CreditCardStatementDetailResult {
  statement: CreditCardStatementRow;
  installments: CreditCardStatementInstallment[];
  payments: CreditCardStatementPayment[];
}

export interface CreditCardStatementsResult {
  data: CreditCardStatementRow[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
}
