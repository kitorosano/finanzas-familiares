import type {
  BALANCE_CONVERSION_STATUSES,
  CURRENCY_CODES,
} from '../constants/money.js';

export type CurrencyCode = (typeof CURRENCY_CODES)[number];

export type BalanceConversionStatus =
  (typeof BALANCE_CONVERSION_STATUSES)[number];
