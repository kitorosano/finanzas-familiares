import { withTransaction } from '../../db/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { ERROR_CODES } from '../../errors/error-codes.js';

import { setAuditActor } from '../audit/audit-context.js';
import { writeAuditLog } from '../audit/audit.db.js';
import type { HouseholdScope } from '../authorization/authorization.types.js';

import {
  createRecurringTransaction as createRecurringTransactionInDb,
  getRecurringTransactionById as getRecurringTransactionByIdFromDb,
  getRecurringTransactionByIdWithClient,
  getRecurringTransactionForUpdate,
  listRecurringTransactions as listRecurringTransactionsFromDb,
  updateRecurringTransaction as updateRecurringTransactionInDb,
} from './recurring-transaction.db.js';

import type {
  CreateRecurringTransactionBody,
  ListRecurringTransactionsQuery,
  RecurringTransactionRow,
  UpdateRecurringTransactionBody,
} from './recurring-transaction.types.js';

import {
  getRecurringTransactionAuditValues,
  getValidatedRecurringTransactionAccount,
  validateRecurringTransactionAmount,
  validateRecurringTransactionCategory,
  validateRecurringTransactionDateRange,
  validateRecurringTransactionDescription,
  validateRecurringTransactionInterval,
} from './recurring-transaction.utils.js';

// =======================================================
// LIST
// =======================================================

export async function listRecurringTransactions(
  scope: HouseholdScope,
  filters: ListRecurringTransactionsQuery,
) {
  if (
    filters.nextOccurrenceFrom !== undefined &&
    filters.nextOccurrenceTo !== undefined &&
    filters.nextOccurrenceFrom > filters.nextOccurrenceTo
  ) {
    throw new AppError(
      400,
      ERROR_CODES.INVALID_RECURRING_TRANSACTION_DATE_RANGE,
      'La fecha inicial del filtro no puede ser posterior a la fecha final',
    );
  }

  return listRecurringTransactionsFromDb(scope.householdId, filters);
}

// =======================================================
// DETAIL
// =======================================================

export async function getRecurringTransactionById(
  scope: HouseholdScope,
  recurringTransactionId: string,
): Promise<RecurringTransactionRow> {
  const recurringTransaction = await getRecurringTransactionByIdFromDb(
    scope.householdId,
    recurringTransactionId,
  );

  if (!recurringTransaction) {
    throw new AppError(
      404,
      ERROR_CODES.RECURRING_TRANSACTION_NOT_FOUND,
      'No se encontró el movimiento recurrente en el hogar',
    );
  }

  return recurringTransaction;
}

// =======================================================
// CREATE
// =======================================================

export async function createRecurringTransaction(
  scope: HouseholdScope,
  body: CreateRecurringTransactionBody,
): Promise<RecurringTransactionRow> {
  const description = validateRecurringTransactionDescription(body.description);

  validateRecurringTransactionAmount(body.amount);

  const intervalValue = body.intervalValue ?? 1;

  validateRecurringTransactionInterval(intervalValue);

  const endDate = body.endDate ?? null;

  validateRecurringTransactionDateRange(body.startDate, endDate);

  return withTransaction(async (client) => {
    await setAuditActor(client, scope.userId);

    const account = await getValidatedRecurringTransactionAccount(
      client,
      scope.householdId,
      body.accountId,
      body.transactionType,
    );

    await validateRecurringTransactionCategory(
      client,
      scope.householdId,
      body.categoryId,
      body.transactionType,
    );

    const recurringTransactionId = await createRecurringTransactionInDb(
      client,
      scope.householdId,
      scope.userId,
      {
        ...body,
        description,
        currencyCode: account.currency_code,
        intervalValue,
        endDate,
      },
    );

    if (!recurringTransactionId) {
      throw new Error(
        'Recurring transaction insert did not return an identifier',
      );
    }

    const recurringTransaction = await getRecurringTransactionByIdWithClient(
      client,
      scope.householdId,
      recurringTransactionId,
    );

    if (!recurringTransaction) {
      throw new Error('Created recurring transaction could not be retrieved');
    }

    await writeAuditLog(client, scope, {
      action: 'create',
      entityName: 'recurring_transactions',
      entityId: recurringTransaction.id,
      newValues: getRecurringTransactionAuditValues(recurringTransaction),
    });

    return recurringTransaction;
  });
}

// =======================================================
// UPDATE
// =======================================================

export async function updateRecurringTransaction(
  scope: HouseholdScope,
  recurringTransactionId: string,
  body: UpdateRecurringTransactionBody,
): Promise<RecurringTransactionRow> {
  const description =
    body.description !== undefined
      ? validateRecurringTransactionDescription(body.description)
      : undefined;

  if (body.amount !== undefined) {
    validateRecurringTransactionAmount(body.amount);
  }

  if (body.intervalValue !== undefined) {
    validateRecurringTransactionInterval(body.intervalValue);
  }

  return withTransaction(async (client) => {
    await setAuditActor(client, scope.userId);

    const current = await getRecurringTransactionForUpdate(
      client,
      scope.householdId,
      recurringTransactionId,
    );

    if (!current) {
      throw new AppError(
        404,
        ERROR_CODES.RECURRING_TRANSACTION_NOT_FOUND,
        'No se encontró el movimiento recurrente en el hogar',
      );
    }

    const transactionType = body.transactionType ?? current.transaction_type;

    const accountId = body.accountId ?? current.account_id;
    const categoryId = body.categoryId ?? current.category_id;

    const startDate = body.startDate ?? current.start_date;
    const endDate =
      body.endDate !== undefined ? body.endDate : current.end_date;

    const amount =
      body.amount !== undefined ? body.amount : Number(current.amount);

    const intervalValue = body.intervalValue ?? current.interval_value;

    const frequency = body.frequency ?? current.frequency;

    const isActive = body.isActive ?? current.is_active;

    const normalizedDescription = description ?? current.description;

    validateRecurringTransactionDateRange(startDate, endDate);

    validateRecurringTransactionAmount(amount);
    validateRecurringTransactionInterval(intervalValue);

    // Revalidate the account when it changes, the transaction
    // type changes, or an inactive recurrence is reactivated.
    const accountNeedsValidation =
      body.accountId !== undefined ||
      body.transactionType !== undefined ||
      (body.isActive === true && !current.is_active);

    let currencyCode = current.currency_code;

    if (accountNeedsValidation) {
      const account = await getValidatedRecurringTransactionAccount(
        client,
        scope.householdId,
        accountId,
        transactionType,
      );

      currencyCode = account.currency_code;
    }

    // Revalidate the category when it changes, the transaction
    // type changes, or an inactive recurrence is reactivated.
    const categoryNeedsValidation =
      body.categoryId !== undefined ||
      body.transactionType !== undefined ||
      (body.isActive === true && !current.is_active);

    if (categoryNeedsValidation) {
      await validateRecurringTransactionCategory(
        client,
        scope.householdId,
        categoryId,
        transactionType,
      );
    }

    // nextOccurrence is system-managed.
    // Changing the start date resets the next scheduled occurrence.
    // Other edits preserve its current value.
    const nextOccurrence = body.startDate ?? current.next_occurrence;

    const updated = await updateRecurringTransactionInDb(
      client,
      scope.householdId,
      recurringTransactionId,
      {
        transactionType,
        description: normalizedDescription,
        amount,
        currencyCode,
        accountId,
        categoryId,
        frequency,
        intervalValue,
        startDate,
        endDate,
        nextOccurrence,
        isActive,
      },
    );

    if (!updated) {
      throw new Error('Recurring transaction update did not affect a row');
    }

    const recurringTransaction = await getRecurringTransactionByIdWithClient(
      client,
      scope.householdId,
      recurringTransactionId,
    );

    if (!recurringTransaction) {
      throw new Error('Updated recurring transaction could not be retrieved');
    }

    await writeAuditLog(client, scope, {
      action: 'update',
      entityName: 'recurring_transactions',
      entityId: recurringTransaction.id,
      oldValues: getRecurringTransactionAuditValues(current),
      newValues: getRecurringTransactionAuditValues(recurringTransaction),
    });

    return recurringTransaction;
  });
}
