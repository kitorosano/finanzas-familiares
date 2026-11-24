// =======================================================
// VALIDATION HELPERS
// =======================================================

import { AppError } from '../../errors/app-error.js';
import { ERROR_CODES } from '../../errors/error-codes.js';
import { CurrencyCode } from '../../types/money.js';
import { isPositiveFiniteNumber } from '../../utils/validation.js';
import {
  TransactionForUpdateRow,
  TransactionQueryRow,
  TransactionRow,
} from '../transactions/transaction.types.js';
import {
  SavingsGoalContributionForUpdateRow,
  SavingsGoalContributionRow,
  SavingsGoalForUpdateRow,
  SavingsGoalRow,
} from './savings-goal.types.js';

export function validateSavingsGoalName(name: string): string {
  const normalizedName = name.trim();

  if (!normalizedName) {
    throw new AppError(
      400,
      ERROR_CODES.INVALID_SAVINGS_GOAL_NAME,
      'El nombre del objetivo no puede estar vacío',
    );
  }

  return normalizedName;
}

export function normalizeOptionalText(
  value: string | null | undefined,
): string | null {
  if (value == null) {
    return null;
  }

  const normalized = value.trim();

  return normalized.length > 0 ? normalized : null;
}

export function resolveExchangeRate(
  suppliedRate: number | undefined,
  currencyCode: CurrencyCode,
  baseCurrencyCode: CurrencyCode,
): number {
  if (currencyCode === baseCurrencyCode) {
    if (suppliedRate !== undefined && suppliedRate !== 1) {
      throw new AppError(
        400,
        ERROR_CODES.INVALID_EXCHANGE_RATE,
        `La tasa de cambio debe ser 1 para la moneda base (${baseCurrencyCode})`,
      );
    }

    return 1;
  }

  if (suppliedRate === undefined || !isPositiveFiniteNumber(suppliedRate)) {
    throw new AppError(
      400,
      ERROR_CODES.EXCHANGE_RATE_REQUIRED,
      `Se requiere una tasa de cambio válida para ${currencyCode}`,
    );
  }

  return suppliedRate;
}

// =======================================================
// AUDIT HELPERS
// =======================================================

export function getSavingsGoalAuditValues(
  goal: SavingsGoalRow | SavingsGoalForUpdateRow,
) {
  if ('household_id' in goal) {
    return {
      name: goal.name,
      description: goal.description,
      targetAmount: goal.target_amount,
      currencyCode: goal.currency_code,
      targetDate: goal.target_date,
      status: goal.status,
    };
  }

  return {
    name: goal.name,
    description: goal.description,
    targetAmount: goal.targetAmount,
    currencyCode: goal.currencyCode,
    targetDate: goal.targetDate,
    status: goal.status,
  };
}

export function getContributionAuditValues(
  contribution:
    | SavingsGoalContributionRow
    | SavingsGoalContributionForUpdateRow,
) {
  if ('goal_id' in contribution) {
    return {
      goalId: contribution.goal_id,
      transactionId: contribution.transaction_id,
      amount: contribution.amount,
      currencyCode: contribution.currency_code,
      contributedAt: contribution.contributed_at.toISOString(),
      notes: contribution.notes,
      status: contribution.status,
      voidedAt: contribution.voided_at?.toISOString() ?? null,
      voidedBy: contribution.voided_by,
      voidReason: contribution.void_reason,
    };
  }

  return {
    goalId: contribution.goalId,
    transactionId: contribution.transactionId,
    amount: contribution.amount,
    currencyCode: contribution.currencyCode,
    contributedAt: contribution.contributedAt.toISOString(),
    notes: contribution.notes,
    status: contribution.status,
    voidedAt: contribution.voidedAt?.toISOString() ?? null,
    voidedBy: contribution.voidedBy,
    voidReason: contribution.voidReason,
  };
}

export function getCreatedTransactionAuditValues(transaction: TransactionRow) {
  return {
    transactionType: transaction.transaction_type,
    status: transaction.status,
    occurredAt: transaction.occurred_at.toISOString(),
    description: transaction.description,
    amount: transaction.amount,
    currencyCode: transaction.currency_code,
    exchangeRateToBase: transaction.exchange_rate_to_base,
    amountBase: transaction.amount_base,
    accountId: transaction.account_id,
    categoryId: transaction.category_id,
    transferAccountId: transaction.transfer_account_id,
    transferAmount: transaction.transfer_amount,
    transferCurrencyCode: transaction.transfer_currency_code,
    transferExchangeRateToBase: transaction.transfer_exchange_rate_to_base,
    transferAmountBase: transaction.transfer_amount_base,
    notes: transaction.notes,
  };
}

export function getTransactionForUpdateAuditValues(
  transaction: TransactionForUpdateRow,
) {
  return {
    transactionType: transaction.transaction_type,
    status: transaction.status,
    occurredAt: transaction.occurred_at.toISOString(),
    description: transaction.description,
    amount: transaction.amount,
    currencyCode: transaction.currency_code,
    exchangeRateToBase: transaction.exchange_rate_to_base,
    amountBase: transaction.amount_base,
    accountId: transaction.account_id,
    categoryId: transaction.category_id,
    transferAccountId: transaction.transfer_account_id,
    transferAmount: transaction.transfer_amount,
    transferCurrencyCode: transaction.transfer_currency_code,
    transferExchangeRateToBase: transaction.transfer_exchange_rate_to_base,
    transferAmountBase: transaction.transfer_amount_base,
    notes: transaction.notes,
  };
}

export function getTransactionQueryAuditValues(
  transaction: TransactionQueryRow,
) {
  return {
    transactionType: transaction.transactionType,
    status: transaction.status,
    occurredAt: transaction.occurredAt.toISOString(),
    voidedAt: transaction.voidedAt?.toISOString() ?? null,
    description: transaction.description,
    amount: transaction.amount,
    currencyCode: transaction.currencyCode,
    exchangeRateToBase: transaction.exchangeRateToBase,
    amountBase: transaction.amountBase,
    accountId: transaction.accountId,
    categoryId: transaction.categoryId,
    transferAccountId: transaction.transferAccountId,
    transferAmount: transaction.transferAmount,
    transferCurrencyCode: transaction.transferCurrencyCode,
    transferExchangeRateToBase: transaction.transferExchangeRateToBase,
    transferAmountBase: transaction.transferAmountBase,
    notes: transaction.notes,
  };
}
