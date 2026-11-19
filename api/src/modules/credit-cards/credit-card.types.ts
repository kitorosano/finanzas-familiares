import type { TransactionRow } from '../transactions/transaction.types.js';
import type {
  BalanceConversionStatus,
  CurrencyCode,
} from '../../types/money.js';
import type { CREDIT_CARD_STATEMENT_STATUSES } from './credit-card.constants.js';

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

export interface CreatedTransactionIdRow {
  transaction_id: string;
}

export interface AllocationSummaryRow {
  allocated_amount: string;
  unapplied_advance: string;
}

export interface CreditCardPositionRow {
  signed_balance: string;
  debt_balance: string;
  credit_balance: string;
  outstanding_statement_balance: string;
  unapplied_advances: string;
}

export type CreditCardStatementStatus =
  (typeof CREDIT_CARD_STATEMENT_STATUSES)[number];

export interface ListCreditCardsQuery {
  currencyCode?: CurrencyCode;
  includeInactive?: boolean;
}

export interface CreditCardRow {
  id: string;
  name: string;
  institution: string | null;
  currencyCode: CurrencyCode;

  holderUserId: string | null;
  holderName: string | null;

  isActive: boolean;
  includeInNetWorth: boolean;
  creditLimit: string | null;

  statementClosingDay: number | null;
  paymentDueDay: number | null;
  paymentDueMonthOffset: number | null;

  balance: string;
  baseCurrencyCode: CurrencyCode;
  exchangeRateToBase: string | null;
  balanceBase: string | null;
  conversionStatus: BalanceConversionStatus;

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
