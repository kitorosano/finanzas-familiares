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
