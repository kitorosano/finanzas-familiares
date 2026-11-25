import type { PoolClient } from 'pg';

import { db } from '../../db/pool.js';
import type { CurrencyCode } from '../../types/money.js';

import {
  RECURRING_TRANSACTION_LIST_LIMIT_DEFAULT,
  RECURRING_TRANSACTION_LIST_OFFSET_DEFAULT,
} from './recurring-transaction.constants.js';

import type {
  CreateRecurringTransactionBody,
  ListRecurringTransactionsQuery,
  RecurringTransactionAccountRow,
  RecurringTransactionForUpdateRow,
  RecurringTransactionRow,
  RecurringTransactionsListResult,
  UpdateRecurringTransactionParams,
} from './recurring-transaction.types.js';

const RECURRING_TRANSACTION_SELECT = `
  SELECT
    rt.id::text AS id,

    rt.transaction_type AS "transactionType",
    rt.description,
    rt.amount::text AS amount,
    rt.currency_code AS "currencyCode",

    rt.account_id::text AS "accountId",
    a.name AS "accountName",
    a.account_type AS "accountType",

    rt.category_id::text AS "categoryId",
    c.name AS "categoryName",
    c.category_type AS "categoryType",

    rt.frequency,
    rt.interval_value AS "intervalValue",

    rt.start_date::text AS "startDate",
    rt.end_date::text AS "endDate",
    rt.next_occurrence::text AS "nextOccurrence",

    rt.is_active AS "isActive",

    rt.created_by::text AS "createdBy",
    rt.created_at AS "createdAt",
    rt.updated_at AS "updatedAt"

  FROM recurring_transactions rt

  JOIN accounts a
    ON a.id = rt.account_id
   AND a.household_id = rt.household_id

  JOIN categories c
    ON c.id = rt.category_id
   AND (
     c.household_id = rt.household_id
     OR c.household_id IS NULL
   )

  WHERE rt.household_id = $1
`;

const RECURRING_TRANSACTION_FILTERS = `
  AND (
    $2::uuid IS NULL
    OR rt.account_id = $2
  )

  AND (
    $3::uuid IS NULL
    OR rt.category_id = $3
  )

  AND (
    $4::varchar IS NULL
    OR rt.transaction_type = $4
  )

  AND (
    $5::varchar IS NULL
    OR rt.frequency = $5
  )

  AND (
    $6::boolean
    OR rt.is_active = TRUE
  )

  AND (
    $7::date IS NULL
    OR rt.next_occurrence >= $7
  )

  AND (
    $8::date IS NULL
    OR rt.next_occurrence <= $8
  )
`;

const RECURRING_TRANSACTION_QUERIES = {
  list: `
    ${RECURRING_TRANSACTION_SELECT}
    ${RECURRING_TRANSACTION_FILTERS}

    ORDER BY
      rt.next_occurrence ASC,
      rt.created_at DESC,
      rt.id

    LIMIT $9
    OFFSET $10
  `,

  count: `
    SELECT COUNT(*)::integer AS total

    FROM recurring_transactions rt

    WHERE rt.household_id = $1

      AND (
        $2::uuid IS NULL
        OR rt.account_id = $2
      )

      AND (
        $3::uuid IS NULL
        OR rt.category_id = $3
      )

      AND (
        $4::varchar IS NULL
        OR rt.transaction_type = $4
      )

      AND (
        $5::varchar IS NULL
        OR rt.frequency = $5
      )

      AND (
        $6::boolean
        OR rt.is_active = TRUE
      )

      AND (
        $7::date IS NULL
        OR rt.next_occurrence >= $7
      )

      AND (
        $8::date IS NULL
        OR rt.next_occurrence <= $8
      )
  `,

  getById: `
    ${RECURRING_TRANSACTION_SELECT}
      AND rt.id = $2

    LIMIT 1
  `,

  getForUpdate: `
    SELECT
      rt.id::text AS id,
      rt.household_id::text AS household_id,

      rt.transaction_type,
      rt.description,
      rt.amount::text AS amount,
      rt.currency_code,

      rt.account_id::text AS account_id,
      rt.category_id::text AS category_id,

      rt.frequency,
      rt.interval_value,

      rt.start_date::text AS start_date,
      rt.end_date::text AS end_date,
      rt.next_occurrence::text AS next_occurrence,

      rt.is_active,

      rt.created_by::text AS created_by,
      rt.created_at,
      rt.updated_at

    FROM recurring_transactions rt

    WHERE rt.household_id = $1
      AND rt.id = $2

    FOR UPDATE OF rt
  `,

  lockAccount: `
    SELECT
      id::text AS id,
      name,
      account_type,
      currency_code,
      is_active

    FROM accounts

    WHERE household_id = $1
      AND id = $2

    FOR UPDATE
  `,

  create: `
    INSERT INTO recurring_transactions (
      household_id,
      transaction_type,
      description,
      amount,
      currency_code,
      account_id,
      category_id,
      frequency,
      interval_value,
      start_date,
      end_date,
      next_occurrence,
      is_active,
      created_by
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7,
      $8,
      $9,
      $10::date,
      $11::date,
      $10::date,
      TRUE,
      $12
    )

    RETURNING id::text AS id
  `,

  update: `
    UPDATE recurring_transactions

    SET
      transaction_type = $3,
      description = $4,
      amount = $5,
      currency_code = $6,

      account_id = $7,
      category_id = $8,

      frequency = $9,
      interval_value = $10,

      start_date = $11::date,
      end_date = $12::date,
      next_occurrence = $13::date,

      is_active = $14

    WHERE household_id = $1
      AND id = $2

    RETURNING id::text AS id
  `,
} as const;

// =======================================================
// LIST
// =======================================================

export async function listRecurringTransactions(
  householdId: string,
  filters: ListRecurringTransactionsQuery,
): Promise<RecurringTransactionsListResult> {
  const queryValues = [
    householdId,
    filters.accountId ?? null,
    filters.categoryId ?? null,
    filters.transactionType ?? null,
    filters.frequency ?? null,
    filters.includeInactive ?? false,
    filters.nextOccurrenceFrom ?? null,
    filters.nextOccurrenceTo ?? null,
  ];

  const limit = filters.limit ?? RECURRING_TRANSACTION_LIST_LIMIT_DEFAULT;

  const offset = filters.offset ?? RECURRING_TRANSACTION_LIST_OFFSET_DEFAULT;

  const [countResult, transactionsResult] = await Promise.all([
    db.query<{ total: number }>(
      RECURRING_TRANSACTION_QUERIES.count,
      queryValues,
    ),

    db.query<RecurringTransactionRow>(RECURRING_TRANSACTION_QUERIES.list, [
      ...queryValues,
      limit,
      offset,
    ]),
  ]);

  return {
    data: transactionsResult.rows,
    pagination: {
      limit,
      offset,
      total: countResult.rows[0]?.total ?? 0,
    },
  };
}

// =======================================================
// DETAIL
// =======================================================

export async function getRecurringTransactionById(
  householdId: string,
  recurringTransactionId: string,
): Promise<RecurringTransactionRow | undefined> {
  const result = await db.query<RecurringTransactionRow>(
    RECURRING_TRANSACTION_QUERIES.getById,
    [householdId, recurringTransactionId],
  );

  return result.rows[0];
}

export async function getRecurringTransactionByIdWithClient(
  client: PoolClient,
  householdId: string,
  recurringTransactionId: string,
): Promise<RecurringTransactionRow | undefined> {
  const result = await client.query<RecurringTransactionRow>(
    RECURRING_TRANSACTION_QUERIES.getById,
    [householdId, recurringTransactionId],
  );

  return result.rows[0];
}

export async function getRecurringTransactionForUpdate(
  client: PoolClient,
  householdId: string,
  recurringTransactionId: string,
): Promise<RecurringTransactionForUpdateRow | undefined> {
  const result = await client.query<RecurringTransactionForUpdateRow>(
    RECURRING_TRANSACTION_QUERIES.getForUpdate,
    [householdId, recurringTransactionId],
  );

  return result.rows[0];
}

// =======================================================
// ACCOUNT LOCK
// =======================================================

export async function lockRecurringTransactionAccount(
  client: PoolClient,
  householdId: string,
  accountId: string,
): Promise<RecurringTransactionAccountRow | undefined> {
  const result = await client.query<RecurringTransactionAccountRow>(
    RECURRING_TRANSACTION_QUERIES.lockAccount,
    [householdId, accountId],
  );

  return result.rows[0];
}

// =======================================================
// CREATE
// =======================================================

export async function createRecurringTransaction(
  client: PoolClient,
  householdId: string,
  userId: string,
  values: CreateRecurringTransactionBody & {
    currencyCode: CurrencyCode;
    intervalValue: number;
    endDate: string | null;
  },
): Promise<string | undefined> {
  const result = await client.query<{ id: string }>(
    RECURRING_TRANSACTION_QUERIES.create,
    [
      householdId,
      values.transactionType,
      values.description,
      values.amount,
      values.currencyCode,
      values.accountId,
      values.categoryId,
      values.frequency,
      values.intervalValue,
      values.startDate,
      values.endDate,
      userId,
    ],
  );

  return result.rows[0]?.id;
}

// =======================================================
// UPDATE
// =======================================================

export async function updateRecurringTransaction(
  client: PoolClient,
  householdId: string,
  recurringTransactionId: string,
  values: UpdateRecurringTransactionParams,
): Promise<boolean> {
  const result = await client.query<{ id: string }>(
    RECURRING_TRANSACTION_QUERIES.update,
    [
      householdId,
      recurringTransactionId,
      values.transactionType,
      values.description,
      values.amount,
      values.currencyCode,
      values.accountId,
      values.categoryId,
      values.frequency,
      values.intervalValue,
      values.startDate,
      values.endDate,
      values.nextOccurrence,
      values.isActive,
    ],
  );

  return result.rows.length > 0;
}
