import type { PoolClient } from 'pg';

import { db } from '../../db/pool.js';
import type { CurrencyCode } from '../../types/money.js';

import {
  BUDGET_LIST_LIMIT_DEFAULT,
  BUDGET_LIST_OFFSET_DEFAULT,
} from './budget.constants.js';
import type {
  BudgetForUpdateRow,
  BudgetRow,
  BudgetsListResult,
  CreateBudgetBody,
  ListBudgetsQuery,
  UpdateBudgetParams,
} from './budget.types.js';

const BUDGET_SELECT = `
  SELECT
    b.id::text AS id,
    b.name,

    b.category_id::text AS "categoryId",
    c.name AS "categoryName",

    b.period_start::text AS "periodStart",
    b.period_end::text AS "periodEnd",

    b.amount::text AS amount,
    b.currency_code AS "currencyCode",

    b.exchange_rate_to_base::text AS "exchangeRateToBase",
    b.amount_base::text AS "amountBase",

    h.base_currency_code AS "baseCurrencyCode",

    COALESCE(spending.spent_amount_base, 0)::text
      AS "spentAmountBase",

    CASE
      WHEN b.amount_base IS NULL THEN NULL
      ELSE (
        b.amount_base - COALESCE(spending.spent_amount_base, 0)
      )::text
    END AS "remainingAmountBase",

    CASE
      WHEN b.amount_base IS NULL THEN NULL
      ELSE ROUND(
        (
          COALESCE(spending.spent_amount_base, 0)
          / NULLIF(b.amount_base, 0)
        ) * 100,
        2
      )::text
    END AS "executionPercentage",

    CASE
      WHEN b.amount_base IS NULL THEN 'missing_rate'
      WHEN b.currency_code = h.base_currency_code THEN 'base_currency'
      ELSE 'converted'
    END AS "conversionStatus",

    b.notes,
    b.is_active AS "isActive",

    b.created_at AS "createdAt",
    b.updated_at AS "updatedAt"

  FROM budgets b

  JOIN households h
    ON h.id = b.household_id

  JOIN categories c
    ON c.id = b.category_id
   AND (
     c.household_id = b.household_id
     OR c.household_id IS NULL
   )

  LEFT JOIN LATERAL (
    WITH RECURSIVE category_tree(id) AS (
      -- The budget category itself.
      SELECT category.id
      FROM categories category
      WHERE category.id = b.category_id
        AND category.category_type = 'expense'
        AND (
          category.household_id = b.household_id
          OR category.household_id IS NULL
        )

      UNION

      -- All descendants belonging to this household
      -- or global/system categories.
      SELECT child.id
      FROM categories child
      JOIN category_tree parent
        ON child.parent_id = parent.id
      WHERE child.category_type = 'expense'
        AND (
          child.household_id = b.household_id
          OR child.household_id IS NULL
        )
    )

    SELECT
      COALESCE(SUM(t.amount_base), 0) AS spent_amount_base

    FROM transactions t

    JOIN category_tree tree
      ON tree.id = t.category_id

    WHERE t.household_id = b.household_id
      AND t.transaction_type = 'expense'
      AND t.status = 'posted'

      AND (
        (t.occurred_at AT TIME ZONE h.time_zone)::date
      ) BETWEEN b.period_start AND b.period_end

  ) spending ON TRUE

  WHERE b.household_id = $1
`;

const BUDGET_FILTERS = `
  AND (
    $2::uuid IS NULL
    OR b.category_id = $2
  )

  AND (
    $3::boolean
    OR b.is_active = TRUE
  )

  AND (
    $4::date IS NULL
    OR b.period_end >= $4
  )

  AND (
    $5::date IS NULL
    OR b.period_start <= $5
  )
`;

const BUDGET_QUERIES = {
  getHouseholdBaseCurrency: `
    SELECT base_currency_code
    FROM households
    WHERE id = $1
    FOR SHARE
  `,

  list: `
    ${BUDGET_SELECT}
    ${BUDGET_FILTERS}

    ORDER BY
      b.period_start DESC,
      c.name,
      b.id

    LIMIT $6
    OFFSET $7
  `,

  count: `
    SELECT COUNT(*)::integer AS total

    FROM budgets b

    WHERE b.household_id = $1

      AND (
        $2::uuid IS NULL
        OR b.category_id = $2
      )

      AND (
        $3::boolean
        OR b.is_active = TRUE
      )

      AND (
        $4::date IS NULL
        OR b.period_end >= $4
      )

      AND (
        $5::date IS NULL
        OR b.period_start <= $5
      )
  `,

  getById: `
    ${BUDGET_SELECT}
      AND b.id = $2

    LIMIT 1
  `,

  getForUpdate: `
    SELECT
      b.id::text AS id,
      b.name,

      b.household_id::text AS household_id,
      b.category_id::text AS category_id,

      b.period_start::text AS period_start,
      b.period_end::text AS period_end,

      b.amount::text AS amount,
      b.currency_code,

      b.exchange_rate_to_base::text AS exchange_rate_to_base,
      b.amount_base::text AS amount_base,

      h.base_currency_code,

      b.notes,
      b.is_active,

      b.created_at,
      b.updated_at

    FROM budgets b

    JOIN households h
      ON h.id = b.household_id

    WHERE b.household_id = $1
      AND b.id = $2

    FOR UPDATE OF b
  `,

  insert: `
    INSERT INTO budgets (
      household_id,
      category_id,
      name,
      period_start,
      period_end,
      amount,
      currency_code,
      exchange_rate_to_base,
      amount_base,
      notes
    )
    VALUES (
      $1,
      $2,
      $3,
      $4::date,
      $5::date,
      $6,
      $7,
      $8,
      ROUND(
        ROUND($6::numeric, 6)
        * ROUND($8::numeric, 10),
        6
      ),
      $9
    )

    RETURNING id::text AS id
  `,

  update: `
    UPDATE budgets
    SET
      category_id = $3,
      name = $4,
      period_start = $5::date,
      period_end = $6::date,

      amount = $7,
      currency_code = $8,
      exchange_rate_to_base = $9,

      amount_base = CASE
        WHEN $9::numeric IS NULL THEN NULL
        ELSE ROUND(
          ROUND($7::numeric, 6) * ROUND($9::numeric, 10),
          6
        )
      END,

      notes = $10,
      is_active = $11

    WHERE household_id = $1
      AND id = $2

    RETURNING id::text AS id
  `,
} as const;

export async function getHouseholdBaseCurrency(
  client: PoolClient,
  householdId: string,
): Promise<CurrencyCode | undefined> {
  const result = await client.query<{
    base_currency_code: CurrencyCode;
  }>(BUDGET_QUERIES.getHouseholdBaseCurrency, [householdId]);

  return result.rows[0]?.base_currency_code;
}

export async function listBudgets(
  householdId: string,
  filters: ListBudgetsQuery,
): Promise<BudgetsListResult> {
  const queryValues = [
    householdId,
    filters.categoryId ?? null,
    filters.includeInactive ?? false,
    filters.periodFrom ?? null,
    filters.periodTo ?? null,
  ];

  const limit = filters.limit ?? BUDGET_LIST_LIMIT_DEFAULT;
  const offset = filters.offset ?? BUDGET_LIST_OFFSET_DEFAULT;

  const [countResult, budgetsResult] = await Promise.all([
    db.query<{ total: number }>(BUDGET_QUERIES.count, queryValues),

    db.query<BudgetRow>(BUDGET_QUERIES.list, [...queryValues, limit, offset]),
  ]);

  return {
    data: budgetsResult.rows,
    pagination: {
      limit,
      offset,
      total: countResult.rows[0]?.total ?? 0,
    },
  };
}

export async function getBudgetById(
  householdId: string,
  budgetId: string,
): Promise<BudgetRow | undefined> {
  const result = await db.query<BudgetRow>(BUDGET_QUERIES.getById, [
    householdId,
    budgetId,
  ]);

  return result.rows[0];
}

export async function getBudgetForUpdate(
  client: PoolClient,
  householdId: string,
  budgetId: string,
): Promise<BudgetForUpdateRow | undefined> {
  const result = await client.query<BudgetForUpdateRow>(
    BUDGET_QUERIES.getForUpdate,
    [householdId, budgetId],
  );

  return result.rows[0];
}

export async function createBudget(
  client: PoolClient,
  householdId: string,
  values: CreateBudgetBody & {
    categoryId: string;
    periodStart: string;
    periodEnd: string;
    amount: number;
    currencyCode: CurrencyCode;
    exchangeRateToBase: number;
    name: string | null;
    notes: string | null;
  },
): Promise<string | undefined> {
  const result = await client.query<{ id: string }>(BUDGET_QUERIES.insert, [
    householdId,
    values.categoryId,
    values.name,
    values.periodStart,
    values.periodEnd,
    values.amount,
    values.currencyCode,
    values.exchangeRateToBase,
    values.notes,
  ]);

  return result.rows[0]?.id;
}

export async function updateBudget(
  client: PoolClient,
  householdId: string,
  budgetId: string,
  values: UpdateBudgetParams,
): Promise<boolean> {
  const result = await client.query<{ id: string }>(BUDGET_QUERIES.update, [
    householdId,
    budgetId,
    values.categoryId,
    values.name,
    values.periodStart,
    values.periodEnd,
    values.amount,
    values.currencyCode,
    values.exchangeRateToBase,
    values.notes,
    values.isActive,
  ]);

  return result.rows.length > 0;
}

export async function getBudgetByIdWithClient(
  client: PoolClient,
  householdId: string,
  budgetId: string,
): Promise<BudgetRow | undefined> {
  const result = await client.query<BudgetRow>(BUDGET_QUERIES.getById, [
    householdId,
    budgetId,
  ]);

  return result.rows[0];
}
