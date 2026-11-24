import { withTransaction } from '../../db/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { ERROR_CODES } from '../../errors/error-codes.js';
import { isPositiveFiniteNumber } from '../../utils/validation.js';

import { setAuditActor } from '../audit/audit-context.js';
import { writeAuditLog } from '../audit/audit.db.js';
import type { HouseholdScope } from '../authorization/authorization.types.js';
import {
  getTransactionByIdWithClient,
  getTransactionForUpdate,
  insertTransaction,
  voidTransaction as voidTransactionInDb,
} from '../transactions/transaction.db.js';

import {
  countSavingsGoalContributions,
  createSavingsGoalContribution as createContributionInDb,
  createSavingsGoal as createSavingsGoalInDb,
  getSavingsGoalBaseCurrency,
  getSavingsGoalById as getSavingsGoalByIdFromDb,
  getSavingsGoalByIdWithClient,
  getSavingsGoalContributionByIdWithClient,
  getSavingsGoalContributionForUpdate,
  getSavingsGoalForUpdate,
  listSavingsGoalContributions as listContributionsFromDb,
  listSavingsGoals as listSavingsGoalsFromDb,
  lockSavingsGoalAccounts,
  updateSavingsGoal as updateSavingsGoalInDb,
  voidSavingsGoalContribution as voidContributionInDb,
} from './savings-goal.db.js';

import type {
  CreateSavingsGoalBody,
  CreateSavingsGoalContributionBody,
  ListSavingsGoalContributionsQuery,
  ListSavingsGoalsQuery,
  SavingsGoalRow,
  UpdateSavingsGoalBody,
  VoidSavingsGoalContributionBody,
} from './savings-goal.types.js';

import type {
  TransactionForUpdateRow,
  TransactionQueryRow,
} from '../transactions/transaction.types.js';
import {
  getContributionAuditValues,
  getCreatedTransactionAuditValues,
  getSavingsGoalAuditValues,
  getTransactionForUpdateAuditValues,
  getTransactionQueryAuditValues,
  normalizeOptionalText,
  resolveExchangeRate,
  validateSavingsGoalName,
} from './savings.goal.utils.js';

export async function listSavingsGoals(
  scope: HouseholdScope,
  filters: ListSavingsGoalsQuery,
) {
  return listSavingsGoalsFromDb(scope.householdId, filters);
}

export async function getSavingsGoalById(
  scope: HouseholdScope,
  goalId: string,
): Promise<SavingsGoalRow> {
  const goal = await getSavingsGoalByIdFromDb(scope.householdId, goalId);

  if (!goal) {
    throw new AppError(
      404,
      ERROR_CODES.SAVINGS_GOAL_NOT_FOUND,
      'No se encontró el objetivo de ahorro en el hogar',
    );
  }

  return goal;
}

export async function createSavingsGoal(
  scope: HouseholdScope,
  body: CreateSavingsGoalBody,
): Promise<SavingsGoalRow> {
  const name = validateSavingsGoalName(body.name);

  if (!isPositiveFiniteNumber(body.targetAmount)) {
    throw new AppError(
      400,
      ERROR_CODES.INVALID_SAVINGS_GOAL_TARGET_AMOUNT,
      'El importe objetivo debe ser mayor que cero',
    );
  }

  return withTransaction(async (client) => {
    await setAuditActor(client, scope.userId);

    const goalId = await createSavingsGoalInDb(client, scope.householdId, {
      ...body,
      name,
      description: normalizeOptionalText(body.description),
      targetDate: body.targetDate ?? null,
    });

    if (!goalId) {
      throw new Error('Savings goal insert did not return an identifier');
    }

    const goal = await getSavingsGoalByIdWithClient(
      client,
      scope.householdId,
      goalId,
    );

    if (!goal) {
      throw new Error('Created savings goal could not be retrieved');
    }

    await writeAuditLog(client, scope, {
      action: 'create',
      entityName: 'savings_goals',
      entityId: goalId,
      newValues: getSavingsGoalAuditValues(goal),
    });

    return goal;
  });
}

export async function updateSavingsGoal(
  scope: HouseholdScope,
  goalId: string,
  body: UpdateSavingsGoalBody,
): Promise<SavingsGoalRow> {
  if (
    body.targetAmount !== undefined &&
    !isPositiveFiniteNumber(body.targetAmount)
  ) {
    throw new AppError(
      400,
      ERROR_CODES.INVALID_SAVINGS_GOAL_TARGET_AMOUNT,
      'El importe objetivo debe ser mayor que cero',
    );
  }

  const normalizedName =
    body.name !== undefined ? validateSavingsGoalName(body.name) : undefined;

  return withTransaction(async (client) => {
    await setAuditActor(client, scope.userId);

    const current = await getSavingsGoalForUpdate(
      client,
      scope.householdId,
      goalId,
    );

    if (!current) {
      throw new AppError(
        404,
        ERROR_CODES.SAVINGS_GOAL_NOT_FOUND,
        'No se encontró el objetivo de ahorro en el hogar',
      );
    }

    if (current.status === 'cancelled') {
      throw new AppError(
        409,
        ERROR_CODES.SAVINGS_GOAL_CANCELLED,
        'No se puede modificar un objetivo cancelado',
      );
    }

    const name = normalizedName ?? current.name;
    const description =
      body.description !== undefined
        ? normalizeOptionalText(body.description)
        : current.description;

    const targetAmount = body.targetAmount ?? Number(current.target_amount);

    const currencyCode = body.currencyCode ?? current.currency_code;

    const targetDate =
      body.targetDate !== undefined ? body.targetDate : current.target_date;

    const status = body.status ?? current.status;

    if (current.status === 'completed' && status !== 'completed') {
      throw new AppError(
        409,
        ERROR_CODES.SAVINGS_GOAL_COMPLETED,
        'No se puede reabrir un objetivo completado',
      );
    }

    if (currencyCode !== current.currency_code) {
      const contributionCount = await countSavingsGoalContributions(
        client,
        scope.householdId,
        goalId,
      );

      if (contributionCount > 0) {
        throw new AppError(
          409,
          ERROR_CODES.SAVINGS_GOAL_CURRENCY_IMMUTABLE,
          'No se puede cambiar la moneda de un objetivo que ya tiene aportes registrados',
        );
      }
    }

    if (status === 'completed') {
      const currentSummary = await getSavingsGoalByIdWithClient(
        client,
        scope.householdId,
        goalId,
      );

      const contributedAmount = Number(currentSummary?.contributedAmount ?? 0);

      if (contributedAmount < targetAmount) {
        throw new AppError(
          409,
          ERROR_CODES.SAVINGS_GOAL_CANNOT_COMPLETE,
          'El objetivo solo puede completarse cuando se alcanza el importe objetivo',
        );
      }
    }

    const updated = await updateSavingsGoalInDb(
      client,
      scope.householdId,
      goalId,
      {
        name,
        description,
        targetAmount,
        currencyCode,
        targetDate,
        status,
      },
    );

    if (!updated) {
      throw new Error('Savings goal update did not affect a row');
    }

    const goal = await getSavingsGoalByIdWithClient(
      client,
      scope.householdId,
      goalId,
    );

    if (!goal) {
      throw new Error('Updated savings goal could not be retrieved');
    }

    await writeAuditLog(client, scope, {
      action: 'update',
      entityName: 'savings_goals',
      entityId: goalId,
      oldValues: getSavingsGoalAuditValues(current),
      newValues: getSavingsGoalAuditValues(goal),
    });

    return goal;
  });
}

// =======================================================
// CONTRIBUTION LIST
// =======================================================

export async function listSavingsGoalContributions(
  scope: HouseholdScope,
  goalId: string,
  filters: ListSavingsGoalContributionsQuery,
) {
  await getSavingsGoalById(scope, goalId);

  return listContributionsFromDb(scope.householdId, goalId, filters);
}

// =======================================================
// CREATE CONTRIBUTION + TRANSFER
// =======================================================

export async function createSavingsGoalContribution(
  scope: HouseholdScope,
  goalId: string,
  body: CreateSavingsGoalContributionBody,
) {
  if (!isPositiveFiniteNumber(body.amount)) {
    throw new AppError(
      400,
      ERROR_CODES.INVALID_SAVINGS_GOAL_CONTRIBUTION_AMOUNT,
      'El importe del aporte debe ser mayor que cero',
    );
  }

  return withTransaction(async (client) => {
    await setAuditActor(client, scope.userId);

    // Lock the goal first. This serializes contributions and
    // prevents concurrent changes to its currency or status.
    const goal = await getSavingsGoalForUpdate(
      client,
      scope.householdId,
      goalId,
    );

    if (!goal) {
      throw new AppError(
        404,
        ERROR_CODES.SAVINGS_GOAL_NOT_FOUND,
        'No se encontró el objetivo de ahorro en el hogar',
      );
    }

    if (goal.status !== 'active') {
      throw new AppError(
        409,
        ERROR_CODES.SAVINGS_GOAL_NOT_ACTIVE,
        'Solo se pueden realizar aportes a objetivos activos',
      );
    }

    if (body.sourceAccountId === body.destinationAccountId) {
      throw new AppError(
        400,
        ERROR_CODES.INVALID_SAVINGS_GOAL_ACCOUNTS,
        'Las cuentas de origen y destino deben ser diferentes',
      );
    }

    const household = await getSavingsGoalBaseCurrency(
      client,
      scope.householdId,
    );

    if (!household) {
      throw new AppError(
        404,
        ERROR_CODES.HOUSEHOLD_NOT_FOUND,
        'No se encontró el hogar de la sesión',
      );
    }

    const accounts = await lockSavingsGoalAccounts(client, scope.householdId, [
      body.sourceAccountId,
      body.destinationAccountId,
    ]);

    const accountsById = new Map(
      accounts.map((account) => [account.id, account]),
    );

    const sourceAccount = accountsById.get(body.sourceAccountId);

    if (!sourceAccount) {
      throw new AppError(
        404,
        ERROR_CODES.ACCOUNT_NOT_FOUND,
        'No se encontró la cuenta de origen en el hogar',
      );
    }

    const destinationAccount = accountsById.get(body.destinationAccountId);

    if (!destinationAccount) {
      throw new AppError(
        404,
        ERROR_CODES.TRANSFER_ACCOUNT_NOT_FOUND,
        'No se encontró la cuenta de destino en el hogar',
      );
    }

    if (!sourceAccount.is_active) {
      throw new AppError(
        400,
        ERROR_CODES.ACCOUNT_INACTIVE,
        'La cuenta de origen está inactiva',
      );
    }

    if (!destinationAccount.is_active) {
      throw new AppError(
        400,
        ERROR_CODES.TRANSFER_ACCOUNT_INACTIVE,
        'La cuenta de destino está inactiva',
      );
    }

    if (
      sourceAccount.account_type === 'credit_card' ||
      destinationAccount.account_type === 'credit_card'
    ) {
      throw new AppError(
        400,
        ERROR_CODES.SAVINGS_GOAL_ACCOUNT_TYPE_NOT_SUPPORTED,
        'No se pueden utilizar tarjetas de crédito para realizar aportes a objetivos de ahorro',
      );
    }

    if (destinationAccount.currency_code !== goal.currency_code) {
      throw new AppError(
        400,
        ERROR_CODES.CURRENCY_MISMATCH,
        'La moneda de la cuenta de destino debe coincidir con la moneda del objetivo',
      );
    }

    const sourceAmount =
      body.sourceAmount ??
      (sourceAccount.currency_code === destinationAccount.currency_code
        ? body.amount
        : undefined);

    if (sourceAmount === undefined || !isPositiveFiniteNumber(sourceAmount)) {
      throw new AppError(
        400,
        ERROR_CODES.INVALID_SAVINGS_GOAL_CONTRIBUTION_AMOUNT,
        'Se requiere un importe de origen válido cuando las cuentas utilizan monedas diferentes',
      );
    }

    if (
      sourceAccount.currency_code === destinationAccount.currency_code &&
      sourceAmount !== body.amount
    ) {
      throw new AppError(
        400,
        ERROR_CODES.CURRENCY_MISMATCH,
        'Cuando las cuentas utilizan la misma moneda, los importes de origen y destino deben coincidir',
      );
    }

    const sourceExchangeRate = resolveExchangeRate(
      body.exchangeRateToBase,
      sourceAccount.currency_code,
      household.base_currency_code,
    );

    const defaultDestinationRate =
      destinationAccount.currency_code === sourceAccount.currency_code
        ? sourceExchangeRate
        : undefined;

    const destinationExchangeRate = resolveExchangeRate(
      body.transferExchangeRateToBase ?? defaultDestinationRate,
      destinationAccount.currency_code,
      household.base_currency_code,
    );

    if (
      destinationAccount.currency_code === sourceAccount.currency_code &&
      sourceExchangeRate !== destinationExchangeRate
    ) {
      throw new AppError(
        400,
        ERROR_CODES.TRANSFER_EXCHANGE_RATE_MISMATCH,
        'Las cuentas utilizan la misma moneda y deben tener la misma tasa de conversión',
      );
    }

    const description = `Aporte a objetivo: ${goal.name}`;

    const transaction = await insertTransaction(client, {
      householdId: scope.householdId,
      transactionType: 'transfer',
      status: 'posted',
      occurredAt: body.occurredAt ?? null,
      description,
      amount: sourceAmount,
      currencyCode: sourceAccount.currency_code,
      exchangeRateToBase: sourceExchangeRate,
      accountId: sourceAccount.id,
      categoryId: null,
      transferAccountId: destinationAccount.id,
      transferAmount: body.amount,
      transferCurrencyCode: destinationAccount.currency_code,
      transferExchangeRateToBase: destinationExchangeRate,
      notes: body.notes ?? null,
      userId: scope.userId,
    });

    if (!transaction) {
      throw new Error('Savings goal transfer insert did not return a row');
    }

    const createdContribution = await createContributionInDb(client, {
      goalId,
      transactionId: transaction.id,
      amount: body.amount,
      currencyCode: goal.currency_code,
      contributedAt: body.occurredAt ?? null,
      notes: normalizeOptionalText(body.notes),
    });

    if (!createdContribution) {
      throw new Error('Savings goal contribution insert did not return a row');
    }

    const contribution = await getSavingsGoalContributionByIdWithClient(
      client,
      scope.householdId,
      goalId,
      createdContribution.id,
    );

    if (!contribution) {
      throw new Error(
        'Created savings goal contribution could not be retrieved',
      );
    }

    await writeAuditLog(client, scope, {
      action: 'create',
      entityName: 'transactions',
      entityId: transaction.id,
      newValues: getCreatedTransactionAuditValues(transaction),
    });

    await writeAuditLog(client, scope, {
      action: 'create',
      entityName: 'savings_goal_contributions',
      entityId: contribution.id,
      newValues: getContributionAuditValues(contribution),
    });

    return {
      contribution,
      transaction,
    };
  });
}

// =======================================================
// VOID CONTRIBUTION + TRANSFER
// =======================================================

export async function voidSavingsGoalContribution(
  scope: HouseholdScope,
  goalId: string,
  contributionId: string,
  body: VoidSavingsGoalContributionBody,
) {
  const reason = body.reason.trim();

  if (!reason) {
    throw new AppError(
      400,
      ERROR_CODES.INVALID_SAVINGS_GOAL_VOID_REASON,
      'El motivo de anulación no puede estar vacío',
    );
  }

  return withTransaction(async (client) => {
    await setAuditActor(client, scope.userId);

    const goal = await getSavingsGoalForUpdate(
      client,
      scope.householdId,
      goalId,
    );

    if (!goal) {
      throw new AppError(
        404,
        ERROR_CODES.SAVINGS_GOAL_NOT_FOUND,
        'No se encontró el objetivo de ahorro en el hogar',
      );
    }

    const contribution = await getSavingsGoalContributionForUpdate(
      client,
      scope.householdId,
      goalId,
      contributionId,
    );

    if (!contribution) {
      throw new AppError(
        404,
        ERROR_CODES.SAVINGS_GOAL_CONTRIBUTION_NOT_FOUND,
        'No se encontró el aporte en el objetivo de ahorro',
      );
    }

    if (contribution.status === 'void') {
      throw new AppError(
        409,
        ERROR_CODES.SAVINGS_GOAL_CONTRIBUTION_ALREADY_VOID,
        'El aporte ya se encuentra anulado',
      );
    }

    let transaction: TransactionQueryRow | undefined;
    let oldTransaction: TransactionForUpdateRow | undefined;

    if (contribution.transaction_id !== null) {
      oldTransaction = await getTransactionForUpdate(
        client,
        scope.householdId,
        contribution.transaction_id,
      );

      if (
        !oldTransaction ||
        oldTransaction.transaction_type !== 'transfer' ||
        oldTransaction.status !== 'posted' ||
        !oldTransaction.transfer_account_id ||
        !oldTransaction.has_savings_goal_contribution
      ) {
        throw new AppError(
          409,
          ERROR_CODES.SAVINGS_GOAL_CONTRIBUTION_TRANSFER_INVALID,
          'La transferencia asociada al aporte no se encuentra en un estado válido para anularse',
        );
      }

      if (
        oldTransaction.has_credit_card_purchase ||
        oldTransaction.has_card_payment_allocations ||
        oldTransaction.account_type === 'credit_card' ||
        oldTransaction.transfer_account_type === 'credit_card'
      ) {
        throw new AppError(
          409,
          ERROR_CODES.SAVINGS_GOAL_CONTRIBUTION_TRANSFER_INVALID,
          'La transferencia asociada tiene dependencias financieras que impiden su anulación',
        );
      }

      const voidedTransaction = await voidTransactionInDb(
        client,
        scope.householdId,
        contribution.transaction_id,
        scope.userId,
      );

      if (!voidedTransaction) {
        throw new Error('Savings goal transfer could not be voided');
      }

      transaction = await getTransactionByIdWithClient(
        client,
        scope.householdId,
        contribution.transaction_id,
      );

      if (!transaction) {
        throw new Error('Voided savings goal transfer could not be retrieved');
      }
    }

    const voided = await voidContributionInDb(
      client,
      scope.householdId,
      goalId,
      contributionId,
      scope.userId,
      reason,
    );

    if (!voided) {
      throw new Error('Savings goal contribution could not be voided');
    }

    const updatedContribution = await getSavingsGoalContributionByIdWithClient(
      client,
      scope.householdId,
      goalId,
      contributionId,
    );

    if (!updatedContribution) {
      throw new Error('Voided contribution could not be retrieved');
    }

    if (oldTransaction && transaction) {
      await writeAuditLog(client, scope, {
        action: 'void',
        entityName: 'transactions',
        entityId: transaction.id,
        oldValues: getTransactionForUpdateAuditValues(oldTransaction),
        newValues: {
          ...getTransactionQueryAuditValues(transaction),
          reason,
        },
      });
    }

    await writeAuditLog(client, scope, {
      action: 'void',
      entityName: 'savings_goal_contributions',
      entityId: contributionId,
      oldValues: getContributionAuditValues(contribution),
      newValues: {
        ...getContributionAuditValues(updatedContribution),
        reason,
      },
    });

    return {
      contribution: updatedContribution,
      transaction,
    };
  });
}
