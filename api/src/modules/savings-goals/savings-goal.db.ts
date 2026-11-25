import type { PoolClient } from 'pg';

import { db } from '../../db/pool.js';
import type { CurrencyCode } from '../../types/money.js';

import {
  SAVINGS_GOAL_CONTRIBUTIONS_LIMIT_DEFAULT,
  SAVINGS_GOAL_CONTRIBUTIONS_OFFSET_DEFAULT,
  SAVINGS_GOAL_LIST_LIMIT_DEFAULT,
  SAVINGS_GOAL_LIST_OFFSET_DEFAULT,
} from './savings-goal.constants.js';

import type {
  CreateSavingsGoalBody,
  CreatedSavingsGoalContributionRow,
  ListSavingsGoalContributionsQuery,
  ListSavingsGoalsQuery,
  SavingsGoalBaseCurrencyRow,
  SavingsGoalContributionForUpdateRow,
  SavingsGoalContributionRow,
  SavingsGoalContributionsListResult,
  SavingsGoalForUpdateRow,
  SavingsGoalRow,
  SavingsGoalsListResult,
  UpdateSavingsGoalParams,
} from './savings-goal.types.js';

// =======================================================
// QUERIES
// =======================================================

const SAVINGS_GOAL_SELECT = `
  SELECT
    g.id::text AS id,
    g.name,
    g.description,

    g.target_amount::text AS "targetAmount",
    g.currency_code AS "currencyCode",
    g.target_date::text AS "targetDate",

    g.status,

    COALESCE(contributions.contributed_amount, 0)::text
      AS "contributedAmount",

    GREATEST(
      g.target_amount - COALESCE(contributions.contributed_amount, 0),
      0
    )::text AS "remainingAmount",

    ROUND(
      (
        COALESCE(contributions.contributed_amount, 0)
        / NULLIF(g.target_amount, 0)
      ) * 100,
      2
    )::text AS "progressPercentage",

    COALESCE(contributions.contribution_count, 0)::integer
      AS "contributionCount",

    g.created_at AS "createdAt",
    g.updated_at AS "updatedAt"

  FROM savings_goals g

  LEFT JOIN LATERAL (
    SELECT
      SUM(c.amount) AS contributed_amount,
      COUNT(*) AS contribution_count

    FROM savings_goal_contributions c

    WHERE c.goal_id = g.id
      AND c.status = 'posted'

  ) contributions ON TRUE

  WHERE g.household_id = $1
`;

const SAVINGS_GOAL_CONTRIBUTION_SELECT = `
  SELECT
    c.id::text AS id,
    c.goal_id::text AS "goalId",

    c.transaction_id::text AS "transactionId",

    c.amount::text AS amount,
    c.currency_code AS "currencyCode",

    c.contributed_at AS "contributedAt",
    c.notes,

    c.status,

    c.voided_at AS "voidedAt",
    c.voided_by::text AS "voidedBy",
    c.void_reason AS "voidReason",

    t.account_id::text AS "sourceAccountId",
    source.name AS "sourceAccountName",
    t.amount::text AS "sourceAmount",
    t.currency_code AS "sourceCurrencyCode",

    t.transfer_account_id::text AS "destinationAccountId",
    destination.name AS "destinationAccountName",

    t.occurred_at AS "transactionOccurredAt"

  FROM savings_goal_contributions c

  JOIN savings_goals g
    ON g.id = c.goal_id

  LEFT JOIN transactions t
    ON t.id = c.transaction_id
   AND t.household_id = g.household_id

  LEFT JOIN accounts source
    ON source.id = t.account_id
   AND source.household_id = t.household_id

  LEFT JOIN accounts destination
    ON destination.id = t.transfer_account_id
   AND destination.household_id = t.household_id

  WHERE g.household_id = $1
    AND g.id = $2
`;

const SAVINGS_GOAL_QUERIES = {
  getHouseholdBaseCurrency: `
    SELECT base_currency_code
    FROM households
    WHERE id = $1
    FOR SHARE
  `,

  list: `
    ${SAVINGS_GOAL_SELECT}
      AND ($2::varchar IS NULL OR g.status = $2)

    ORDER BY
      g.created_at DESC,
      g.id

    LIMIT $3
    OFFSET $4
  `,

  count: `
    SELECT COUNT(*)::integer AS total

    FROM savings_goals g

    WHERE g.household_id = $1
      AND ($2::varchar IS NULL OR g.status = $2)
  `,

  getById: `
    ${SAVINGS_GOAL_SELECT}
      AND g.id = $2

    LIMIT 1
  `,

  getForUpdate: `
    SELECT
      g.id::text AS id,
      g.household_id::text AS household_id,

      g.name,
      g.description,

      g.target_amount::text AS target_amount,
      g.currency_code,
      g.target_date::text AS target_date,

      g.status,

      g.created_at,
      g.updated_at

    FROM savings_goals g

    WHERE g.household_id = $1
      AND g.id = $2

    FOR UPDATE OF g
  `,

  countContributions: `
    SELECT COUNT(*)::integer AS total

    FROM savings_goal_contributions c

    JOIN savings_goals g
      ON g.id = c.goal_id

    WHERE g.household_id = $1
      AND g.id = $2
  `,

  create: `
    INSERT INTO savings_goals (
      household_id,
      name,
      description,
      target_amount,
      currency_code,
      target_date
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6::date
    )

    RETURNING id::text AS id
  `,

  update: `
    UPDATE savings_goals
    SET
      name = $3,
      description = $4,
      target_amount = $5,
      currency_code = $6,
      target_date = $7::date,
      status = $8

    WHERE household_id = $1
      AND id = $2

    RETURNING id::text AS id
  `,

  listContributions: `
    ${SAVINGS_GOAL_CONTRIBUTION_SELECT}
      AND ($3::varchar IS NULL OR c.status = $3)

    ORDER BY
      c.contributed_at DESC,
      c.id DESC

    LIMIT $4
    OFFSET $5
  `,

  countContributionsByStatus: `
    SELECT COUNT(*)::integer AS total

    FROM savings_goal_contributions c

    JOIN savings_goals g
      ON g.id = c.goal_id

    WHERE g.household_id = $1
      AND g.id = $2
      AND ($3::varchar IS NULL OR c.status = $3)
  `,

  getContributionForUpdate: `
    SELECT
      c.id::text AS id,
      c.goal_id::text AS goal_id,
      c.transaction_id::text AS transaction_id,

      c.amount::text AS amount,
      c.currency_code,

      c.contributed_at,
      c.notes,

      c.status,

      c.voided_at,
      c.voided_by::text AS voided_by,
      c.void_reason

    FROM savings_goal_contributions c

    JOIN savings_goals g
      ON g.id = c.goal_id

    WHERE g.household_id = $1
      AND g.id = $2
      AND c.id = $3

    FOR UPDATE OF c
  `,

  createContribution: `
    INSERT INTO savings_goal_contributions (
      goal_id,
      transaction_id,
      amount,
      currency_code,
      contributed_at,
      notes,
      status
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      COALESCE($5::timestamptz, NOW()),
      $6,
      'posted'
    )

    RETURNING
      id::text AS id,
      goal_id::text AS goal_id,
      transaction_id::text AS transaction_id,

      amount::text AS amount,
      currency_code,

      contributed_at,
      notes,

      status,

      created_at
  `,

  voidContribution: `
    UPDATE savings_goal_contributions c

    SET
      status = 'void',
      voided_at = NOW(),
      voided_by = $4,
      void_reason = $5

    FROM savings_goals g

    WHERE c.goal_id = g.id
      AND g.household_id = $1
      AND g.id = $2
      AND c.id = $3
      AND c.status = 'posted'

    RETURNING c.id::text AS id
  `,
} as const;

// =======================================================
// SAVINGS GOALS
// =======================================================

export async function getSavingsGoalBaseCurrency(
  client: PoolClient,
  householdId: string,
): Promise<SavingsGoalBaseCurrencyRow | undefined> {
  const result = await client.query<SavingsGoalBaseCurrencyRow>(
    SAVINGS_GOAL_QUERIES.getHouseholdBaseCurrency,
    [householdId],
  );

  return result.rows[0];
}

export async function listSavingsGoals(
  householdId: string,
  filters: ListSavingsGoalsQuery,
): Promise<SavingsGoalsListResult> {
  const queryValues = [householdId, filters.status ?? null];

  const limit = filters.limit ?? SAVINGS_GOAL_LIST_LIMIT_DEFAULT;

  const offset = filters.offset ?? SAVINGS_GOAL_LIST_OFFSET_DEFAULT;

  const [countResult, goalsResult] = await Promise.all([
    db.query<{ total: number }>(SAVINGS_GOAL_QUERIES.count, queryValues),

    db.query<SavingsGoalRow>(SAVINGS_GOAL_QUERIES.list, [
      ...queryValues,
      limit,
      offset,
    ]),
  ]);

  return {
    data: goalsResult.rows,
    pagination: {
      limit,
      offset,
      total: countResult.rows[0]?.total ?? 0,
    },
  };
}

export async function getSavingsGoalById(
  householdId: string,
  goalId: string,
): Promise<SavingsGoalRow | undefined> {
  const result = await db.query<SavingsGoalRow>(SAVINGS_GOAL_QUERIES.getById, [
    householdId,
    goalId,
  ]);

  return result.rows[0];
}

export async function getSavingsGoalByIdWithClient(
  client: PoolClient,
  householdId: string,
  goalId: string,
): Promise<SavingsGoalRow | undefined> {
  const result = await client.query<SavingsGoalRow>(
    SAVINGS_GOAL_QUERIES.getById,
    [householdId, goalId],
  );

  return result.rows[0];
}

export async function getSavingsGoalForUpdate(
  client: PoolClient,
  householdId: string,
  goalId: string,
): Promise<SavingsGoalForUpdateRow | undefined> {
  const result = await client.query<SavingsGoalForUpdateRow>(
    SAVINGS_GOAL_QUERIES.getForUpdate,
    [householdId, goalId],
  );

  return result.rows[0];
}

export async function countSavingsGoalContributions(
  client: PoolClient,
  householdId: string,
  goalId: string,
): Promise<number> {
  const result = await client.query<{ total: number }>(
    SAVINGS_GOAL_QUERIES.countContributions,
    [householdId, goalId],
  );

  return result.rows[0]?.total ?? 0;
}

export async function createSavingsGoal(
  client: PoolClient,
  householdId: string,
  values: CreateSavingsGoalBody & {
    description: string | null;
    targetDate: string | null;
  },
): Promise<string | undefined> {
  const result = await client.query<{ id: string }>(
    SAVINGS_GOAL_QUERIES.create,
    [
      householdId,
      values.name,
      values.description,
      values.targetAmount,
      values.currencyCode,
      values.targetDate,
    ],
  );

  return result.rows[0]?.id;
}

export async function updateSavingsGoal(
  client: PoolClient,
  householdId: string,
  goalId: string,
  values: UpdateSavingsGoalParams,
): Promise<boolean> {
  const result = await client.query<{ id: string }>(
    SAVINGS_GOAL_QUERIES.update,
    [
      householdId,
      goalId,
      values.name,
      values.description,
      values.targetAmount,
      values.currencyCode,
      values.targetDate,
      values.status,
    ],
  );

  return result.rows.length > 0;
}

// =======================================================
// CONTRIBUTIONS
// =======================================================

export async function listSavingsGoalContributions(
  householdId: string,
  goalId: string,
  filters: ListSavingsGoalContributionsQuery,
): Promise<SavingsGoalContributionsListResult> {
  const queryValues = [householdId, goalId, filters.status ?? null];

  const limit = filters.limit ?? SAVINGS_GOAL_CONTRIBUTIONS_LIMIT_DEFAULT;

  const offset = filters.offset ?? SAVINGS_GOAL_CONTRIBUTIONS_OFFSET_DEFAULT;

  const [countResult, contributionsResult] = await Promise.all([
    db.query<{ total: number }>(
      SAVINGS_GOAL_QUERIES.countContributionsByStatus,
      queryValues,
    ),

    db.query<SavingsGoalContributionRow>(
      SAVINGS_GOAL_QUERIES.listContributions,
      [...queryValues, limit, offset],
    ),
  ]);

  return {
    data: contributionsResult.rows,
    pagination: {
      limit,
      offset,
      total: countResult.rows[0]?.total ?? 0,
    },
  };
}

export async function getSavingsGoalContributionForUpdate(
  client: PoolClient,
  householdId: string,
  goalId: string,
  contributionId: string,
): Promise<SavingsGoalContributionForUpdateRow | undefined> {
  const result = await client.query<SavingsGoalContributionForUpdateRow>(
    SAVINGS_GOAL_QUERIES.getContributionForUpdate,
    [householdId, goalId, contributionId],
  );

  return result.rows[0];
}

export async function createSavingsGoalContribution(
  client: PoolClient,
  values: {
    goalId: string;
    transactionId: string;
    amount: number;
    currencyCode: CurrencyCode;
    contributedAt: string | null;
    notes: string | null;
  },
): Promise<CreatedSavingsGoalContributionRow | undefined> {
  const result = await client.query<CreatedSavingsGoalContributionRow>(
    SAVINGS_GOAL_QUERIES.createContribution,
    [
      values.goalId,
      values.transactionId,
      values.amount,
      values.currencyCode,
      values.contributedAt,
      values.notes,
    ],
  );

  return result.rows[0];
}

export async function getSavingsGoalContributionByIdWithClient(
  client: PoolClient,
  householdId: string,
  goalId: string,
  contributionId: string,
): Promise<SavingsGoalContributionRow | undefined> {
  const result = await client.query<SavingsGoalContributionRow>(
    `
      ${SAVINGS_GOAL_CONTRIBUTION_SELECT}
        AND c.id = $3

      LIMIT 1
    `,
    [householdId, goalId, contributionId],
  );

  return result.rows[0];
}

export async function voidSavingsGoalContribution(
  client: PoolClient,
  householdId: string,
  goalId: string,
  contributionId: string,
  userId: string,
  reason: string,
): Promise<boolean> {
  const result = await client.query<{ id: string }>(
    SAVINGS_GOAL_QUERIES.voidContribution,
    [householdId, goalId, contributionId, userId, reason],
  );

  return result.rows.length > 0;
}
