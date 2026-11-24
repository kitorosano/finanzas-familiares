import { AppError } from '../../errors/app-error.js';
import { ERROR_CODES } from '../../errors/error-codes.js';
import { CurrencyCode } from '../../types/money.js';
import { isPositiveFiniteNumber } from '../../utils/validation.js';
import { getActiveCategories } from '../categories/category.db.js';
import { BudgetForUpdateRow, BudgetRow } from './budget.types.js';

export function validateBudgetName(
  name: string | null | undefined,
): string | null {
  if (name == null) {
    return null;
  }

  const normalizedName = name.trim();

  if (!normalizedName) {
    throw new AppError(
      400,
      ERROR_CODES.INVALID_BUDGET_NAME,
      'El nombre del presupuesto no puede estar vacío',
    );
  }

  return normalizedName;
}

export function validateBudgetDateRange(
  periodStart: string,
  periodEnd: string,
): void {
  if (periodStart > periodEnd) {
    throw new AppError(
      400,
      ERROR_CODES.INVALID_BUDGET_DATE_RANGE,
      'La fecha inicial no puede ser posterior a la fecha final',
    );
  }
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

export async function validateBudgetCategory(
  client: Parameters<typeof getActiveCategories>[0],
  householdId: string,
  categoryId: string,
): Promise<void> {
  const category = await getActiveCategories(client, householdId, categoryId);

  if (!category) {
    throw new AppError(
      404,
      ERROR_CODES.CATEGORY_NOT_FOUND,
      'No se encontró una categoría activa en el hogar',
    );
  }

  if (category.categoryType !== 'expense') {
    throw new AppError(
      400,
      ERROR_CODES.BUDGET_CATEGORY_MUST_BE_EXPENSE,
      'Los presupuestos solamente pueden asociarse a categorías de gastos',
    );
  }
}

export function isBudgetConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const databaseError = error as {
    code?: string;
    constraint?: string;
  };

  return (
    databaseError.code === '23505' &&
    databaseError.constraint ===
      'budgets_household_id_category_id_period_start_period_end_key'
  );
}

export function getBudgetAuditValues(budget: BudgetRow) {
  return {
    name: budget.name,
    categoryId: budget.categoryId,
    periodStart: budget.periodStart,
    periodEnd: budget.periodEnd,
    amount: budget.amount,
    currencyCode: budget.currencyCode,
    exchangeRateToBase: budget.exchangeRateToBase,
    amountBase: budget.amountBase,
    baseCurrencyCode: budget.baseCurrencyCode,
    notes: budget.notes,
    isActive: budget.isActive,
  };
}

export function getBudgetForUpdateAuditValues(budget: BudgetForUpdateRow) {
  return {
    name: budget.name,
    categoryId: budget.category_id,
    periodStart: budget.period_start,
    periodEnd: budget.period_end,
    amount: budget.amount,
    currencyCode: budget.currency_code,
    exchangeRateToBase: budget.exchange_rate_to_base,
    amountBase: budget.amount_base,
    baseCurrencyCode: budget.base_currency_code,
    notes: budget.notes,
    isActive: budget.is_active,
  };
}
