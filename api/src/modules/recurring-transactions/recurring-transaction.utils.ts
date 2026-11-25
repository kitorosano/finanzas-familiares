import type { PoolClient } from 'pg';

import { AppError } from '../../errors/app-error.js';
import { ERROR_CODES } from '../../errors/error-codes.js';

import { getActiveCategories } from '../categories/category.db.js';

import { lockAccounts } from '../accounts/account.db.js';
import type { AccountLockRow } from '../accounts/account.types.js';

import { isPositiveFiniteNumber } from '../../utils/validation.js';
import {
  RECURRING_TRANSACTION_INTERVAL_MAX,
  RECURRING_TRANSACTION_INTERVAL_MIN,
} from './recurring-transaction.constants.js';
import type {
  RecurringTransactionForUpdateRow,
  RecurringTransactionRow,
  RecurringTransactionType,
} from './recurring-transaction.types.js';

// =======================================================
// DESCRIPTION
// =======================================================

export function validateRecurringTransactionDescription(
  description: string,
): string {
  const normalizedDescription = description.trim();

  if (!normalizedDescription) {
    throw new AppError(
      400,
      ERROR_CODES.INVALID_RECURRING_TRANSACTION_DESCRIPTION,
      'La descripción del movimiento recurrente no puede estar vacía',
    );
  }

  return normalizedDescription;
}

// =======================================================
// DATE RANGE
// =======================================================

export function validateRecurringTransactionDateRange(
  startDate: string,
  endDate: string | null,
): void {
  if (endDate !== null && endDate < startDate) {
    throw new AppError(
      400,
      ERROR_CODES.INVALID_RECURRING_TRANSACTION_DATE_RANGE,
      'La fecha de finalización no puede ser anterior a la fecha de inicio',
    );
  }
}

export function validateRecurringTransactionAmount(amount: number): void {
  if (!isPositiveFiniteNumber(amount)) {
    throw new AppError(
      400,
      ERROR_CODES.INVALID_RECURRING_TRANSACTION_AMOUNT,
      'El importe del movimiento recurrente debe ser mayor que cero',
    );
  }
}

export function validateRecurringTransactionInterval(
  intervalValue: number,
): void {
  if (
    !Number.isInteger(intervalValue) ||
    intervalValue < RECURRING_TRANSACTION_INTERVAL_MIN ||
    intervalValue > RECURRING_TRANSACTION_INTERVAL_MAX
  ) {
    throw new AppError(
      400,
      ERROR_CODES.INVALID_RECURRING_TRANSACTION_INTERVAL,
      'El intervalo debe ser un número entero entre 1 y 3650',
    );
  }
}

// =======================================================
// ACCOUNT
// =======================================================

export async function getValidatedRecurringTransactionAccount(
  client: PoolClient,
  householdId: string,
  accountId: string,
  transactionType: RecurringTransactionType,
): Promise<AccountLockRow> {
  const [account] = await lockAccounts(client, householdId, [accountId]);

  if (!account) {
    throw new AppError(
      404,
      ERROR_CODES.ACCOUNT_NOT_FOUND,
      'No se encontró la cuenta en el hogar',
    );
  }

  if (!account.is_active) {
    throw new AppError(
      400,
      ERROR_CODES.ACCOUNT_INACTIVE,
      'No se puede utilizar una cuenta inactiva para una recurrencia',
    );
  }

  // Credit cards support recurring expenses.
  // Recurring income cannot be registered against a credit card.
  if (account.account_type === 'credit_card' && transactionType === 'income') {
    throw new AppError(
      400,
      ERROR_CODES.RECURRING_TRANSACTION_ACCOUNT_TYPE_NOT_SUPPORTED,
      'No se pueden programar ingresos en cuentas de tarjeta de crédito',
    );
  }

  return account;
}

// =======================================================
// CATEGORY
// =======================================================

export async function validateRecurringTransactionCategory(
  client: PoolClient,
  householdId: string,
  categoryId: string,
  transactionType: RecurringTransactionType,
): Promise<void> {
  const category = await getActiveCategories(client, householdId, categoryId);

  if (!category) {
    throw new AppError(
      404,
      ERROR_CODES.CATEGORY_NOT_FOUND,
      'No se encontró una categoría activa en el hogar',
    );
  }

  if (category.categoryType !== transactionType) {
    throw new AppError(
      400,
      ERROR_CODES.CATEGORY_TYPE_MISMATCH,
      'La categoría no corresponde al tipo de movimiento recurrente',
    );
  }
}

// =======================================================
// AUDIT VALUES
// =======================================================

export function getRecurringTransactionAuditValues(
  recurringTransaction:
    | RecurringTransactionRow
    | RecurringTransactionForUpdateRow,
) {
  if ('household_id' in recurringTransaction) {
    return {
      transactionType: recurringTransaction.transaction_type,
      description: recurringTransaction.description,
      amount: recurringTransaction.amount,
      currencyCode: recurringTransaction.currency_code,
      accountId: recurringTransaction.account_id,
      categoryId: recurringTransaction.category_id,
      frequency: recurringTransaction.frequency,
      intervalValue: recurringTransaction.interval_value,
      startDate: recurringTransaction.start_date,
      endDate: recurringTransaction.end_date,
      nextOccurrence: recurringTransaction.next_occurrence,
      isActive: recurringTransaction.is_active,
    };
  }

  return {
    transactionType: recurringTransaction.transactionType,
    description: recurringTransaction.description,
    amount: recurringTransaction.amount,
    currencyCode: recurringTransaction.currencyCode,
    accountId: recurringTransaction.accountId,
    categoryId: recurringTransaction.categoryId,
    frequency: recurringTransaction.frequency,
    intervalValue: recurringTransaction.intervalValue,
    startDate: recurringTransaction.startDate,
    endDate: recurringTransaction.endDate,
    nextOccurrence: recurringTransaction.nextOccurrence,
    isActive: recurringTransaction.isActive,
  };
}
