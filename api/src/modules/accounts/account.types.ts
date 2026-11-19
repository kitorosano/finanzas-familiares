export const ACCOUNT_TYPES = [
  'cash',
  'bank',
  'digital_wallet',
  'credit_card',
  'investment',
  'other',
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const CURRENCY_CODES = ['UYU', 'USD', 'ARS', 'BRL'] as const;

export type CurrencyCode = (typeof CURRENCY_CODES)[number];

export interface ListAccountsQuery {
  accountType?: AccountType;
  currencyCode?: CurrencyCode;
  includeInactive?: boolean;
}

export interface AccountRow {
  id: string;
  name: string;
  accountType: AccountType;
  currencyCode: CurrencyCode;
  institution: string | null;

  holderUserId: string | null;
  holderName: string | null;

  openingBalance: string;
  openingBalanceDate: string;

  creditLimit: string | null;

  includeInNetWorth: boolean;
  isActive: boolean;
  isLiability: boolean;

  balance: string;
  baseCurrencyCode: CurrencyCode;
  exchangeRateToBase: string | null;
  balanceBase: string | null;
  conversionStatus:
    | 'base_currency'
    | 'zero_balance'
    | 'converted'
    | 'missing_rate';

  statementClosingDay: number | null;
  paymentDueDay: number | null;
  paymentDueMonthOffset: number | null;

  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}
