import { withTransaction } from '../../db/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { ERROR_CODES } from '../../errors/error-codes.js';

import { setAuditActor } from '../audit/audit-context.js';
import { writeAuditLog } from '../audit/audit.db.js';
import type { HouseholdScope } from '../authorization/authorization.types.js';

import {
  createBudget as createBudgetInDb,
  getBudgetById as getBudgetByIdFromDb,
  getBudgetByIdWithClient,
  getBudgetForUpdate,
  getHouseholdBaseCurrency,
  listBudgets as listBudgetsFromDb,
  updateBudget as updateBudgetInDb,
} from './budget.db.js';

import type {
  BudgetRow,
  CreateBudgetBody,
  ListBudgetsQuery,
  UpdateBudgetBody,
} from './budget.types.js';
import {
  getBudgetAuditValues,
  getBudgetForUpdateAuditValues,
  isBudgetConflict,
  resolveExchangeRate,
  validateBudgetCategory,
  validateBudgetDateRange,
  validateBudgetName,
} from './budget.utils.js';

export async function listBudgets(
  scope: HouseholdScope,
  filters: ListBudgetsQuery,
) {
  if (
    filters.periodFrom !== undefined &&
    filters.periodTo !== undefined &&
    filters.periodFrom > filters.periodTo
  ) {
    throw new AppError(
      400,
      ERROR_CODES.INVALID_BUDGET_DATE_RANGE,
      'La fecha inicial del filtro no puede ser posterior a la fecha final',
    );
  }

  return listBudgetsFromDb(scope.householdId, filters);
}

export async function getBudgetById(
  scope: HouseholdScope,
  budgetId: string,
): Promise<BudgetRow> {
  const budget = await getBudgetByIdFromDb(scope.householdId, budgetId);

  if (!budget) {
    throw new AppError(
      404,
      ERROR_CODES.BUDGET_NOT_FOUND,
      'No se encontró el presupuesto en el hogar',
    );
  }

  return budget;
}

export async function createBudget(
  scope: HouseholdScope,
  body: CreateBudgetBody,
): Promise<BudgetRow> {
  const name = validateBudgetName(body.name);

  validateBudgetDateRange(body.periodStart, body.periodEnd);

  try {
    return await withTransaction(async (client) => {
      await setAuditActor(client, scope.userId);

      const baseCurrencyCode = await getHouseholdBaseCurrency(
        client,
        scope.householdId,
      );

      if (!baseCurrencyCode) {
        throw new AppError(
          404,
          ERROR_CODES.HOUSEHOLD_NOT_FOUND,
          'No se encontró el hogar de la sesión',
        );
      }

      await validateBudgetCategory(client, scope.householdId, body.categoryId);

      const exchangeRateToBase = resolveExchangeRate(
        body.exchangeRateToBase,
        body.currencyCode,
        baseCurrencyCode,
      );

      const budgetId = await createBudgetInDb(client, scope.householdId, {
        ...body,
        name,
        notes: body.notes ?? null,
        exchangeRateToBase,
      });

      if (!budgetId) {
        throw new Error('Budget insert did not return an identifier');
      }

      const budget = await getBudgetByIdWithClient(
        client,
        scope.householdId,
        budgetId,
      );

      if (!budget) {
        throw new Error('Created budget could not be retrieved');
      }

      await writeAuditLog(client, scope, {
        action: 'create',
        entityName: 'budgets',
        entityId: budget.id,
        newValues: getBudgetAuditValues(budget),
      });

      return budget;
    });
  } catch (error) {
    if (isBudgetConflict(error)) {
      throw new AppError(
        409,
        ERROR_CODES.BUDGET_ALREADY_EXISTS,
        'Ya existe un presupuesto para esa categoría y período',
      );
    }

    throw error;
  }
}

export async function updateBudget(
  scope: HouseholdScope,
  budgetId: string,
  body: UpdateBudgetBody,
): Promise<BudgetRow> {
  const name =
    body.name !== undefined ? validateBudgetName(body.name) : undefined;

  try {
    return await withTransaction(async (client) => {
      await setAuditActor(client, scope.userId);

      const current = await getBudgetForUpdate(
        client,
        scope.householdId,
        budgetId,
      );

      if (!current) {
        throw new AppError(
          404,
          ERROR_CODES.BUDGET_NOT_FOUND,
          'No se encontró el presupuesto en el hogar',
        );
      }

      const categoryId = body.categoryId ?? current.category_id;
      const periodStart = body.periodStart ?? current.period_start;
      const periodEnd = body.periodEnd ?? current.period_end;
      const amount =
        body.amount !== undefined ? body.amount : Number(current.amount);
      const currencyCode = body.currencyCode ?? current.currency_code;
      const notes = body.notes !== undefined ? body.notes : current.notes;
      const isActive = body.isActive ?? current.is_active;

      validateBudgetDateRange(periodStart, periodEnd);

      const categoryChanged =
        body.categoryId !== undefined &&
        body.categoryId !== current.category_id;

      const reactivatingBudget = body.isActive === true && !current.is_active;

      if (categoryChanged || reactivatingBudget) {
        await validateBudgetCategory(client, scope.householdId, categoryId);
      }

      let exchangeRateToBase: number | null;

      if (currencyCode === current.base_currency_code) {
        exchangeRateToBase = resolveExchangeRate(
          body.exchangeRateToBase,
          currencyCode,
          current.base_currency_code,
        );
      } else if (body.exchangeRateToBase !== undefined) {
        exchangeRateToBase = resolveExchangeRate(
          body.exchangeRateToBase,
          currencyCode,
          current.base_currency_code,
        );
      } else if (currencyCode !== current.currency_code) {
        exchangeRateToBase = resolveExchangeRate(
          undefined,
          currencyCode,
          current.base_currency_code,
        );
      } else if (current.exchange_rate_to_base !== null) {
        exchangeRateToBase = Number(current.exchange_rate_to_base);
      } else if (body.amount !== undefined) {
        // A legacy budget without a conversion snapshot cannot
        // recalculate its base amount without a new exchange rate.
        exchangeRateToBase = resolveExchangeRate(
          undefined,
          currencyCode,
          current.base_currency_code,
        );
      } else {
        // Preserve the missing snapshot until the user supplies
        // a conversion rate or changes the currency.
        exchangeRateToBase = null;
      }

      const updated = await updateBudgetInDb(
        client,
        scope.householdId,
        budgetId,
        {
          name: body.name !== undefined ? (name ?? null) : current.name,
          categoryId,
          periodStart,
          periodEnd,
          amount,
          currencyCode,
          exchangeRateToBase,
          notes,
          isActive,
        },
      );

      if (!updated) {
        throw new Error('Budget update did not affect a row');
      }

      const budget = await getBudgetByIdWithClient(
        client,
        scope.householdId,
        budgetId,
      );

      if (!budget) {
        throw new Error('Updated budget could not be retrieved');
      }

      await writeAuditLog(client, scope, {
        action: 'update',
        entityName: 'budgets',
        entityId: budgetId,
        oldValues: getBudgetForUpdateAuditValues(current),
        newValues: getBudgetAuditValues(budget),
      });

      return budget;
    });
  } catch (error) {
    if (isBudgetConflict(error)) {
      throw new AppError(
        409,
        ERROR_CODES.BUDGET_ALREADY_EXISTS,
        'Ya existe un presupuesto para esa categoría y período',
      );
    }

    throw error;
  }
}
