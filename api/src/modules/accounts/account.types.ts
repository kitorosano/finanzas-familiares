import type {
  BalanceConversionStatus,
  CurrencyCode,
} from '../../types/money.js';
import type { ACCOUNT_TYPES } from './account.constants.js';

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export interface AccountLockRow {
  id: string;
  name: string;
  account_type: AccountType;
  currency_code: CurrencyCode;
  is_active: boolean;
}

export type AccountValidationRow = Omit<AccountLockRow, 'name'>;

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
  conversionStatus: BalanceConversionStatus;

  statementClosingDay: number | null;
  paymentDueDay: number | null;
  paymentDueMonthOffset: number | null;

  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}
