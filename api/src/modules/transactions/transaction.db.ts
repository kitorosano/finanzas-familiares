import type { PoolClient } from 'pg';

import { db } from '../../db/pool.js';

import type { HouseholdBaseCurrencyRow } from '../../types/household.js';
import type { CurrencyCode } from '../../types/money.js';
import type { AccountValidationRow } from '../accounts/account.types.js';

import type {
  CreatedPurchaseRow,
  InsertTransactionParams,
  ListTransactionsQuery,
  TransactionForUpdateRow,
  TransactionQueryRow,
  TransactionRow,
  TransactionsListResult,
  TransactionStatus,
} from './transaction.types.js';

const TRANSACTION_SELECT = `
  SELECT
    t.id::text AS id,
    t.transaction_type AS "transactionType",
    t.status,

    t.occurred_at AS "occurredAt",
    t.voided_at AS "voidedAt",
    t.description,

    t.amount::text AS amount,
    t.currency_code AS "currencyCode",
    t.exchange_rate_to_base::text AS "exchangeRateToBase",
    t.amount_base::text AS "amountBase",

    t.account_id::text AS "accountId",
    a.name AS "accountName",
    a.account_type AS "accountType",

    t.category_id::text AS "categoryId",
    c.name AS "categoryName",
    c.category_type AS "categoryType",

    t.transfer_account_id::text AS "transferAccountId",
    ta.name AS "transferAccountName",
    t.transfer_amount::text AS "transferAmount",
    t.transfer_currency_code AS "transferCurrencyCode",
    t.transfer_exchange_rate_to_base::text AS "transferExchangeRateToBase",
    t.transfer_amount_base::text AS "transferAmountBase",

    ccp.id::text AS "creditCardPurchaseId",
    ccp.installments_count AS "installmentsCount",
    ccp.first_due_date::text AS "firstDueDate",

    t.notes,

    t.created_by::text AS "createdBy",
    t.updated_by::text AS "updatedBy",

    t.created_at AS "createdAt",
    t.updated_at AS "updatedAt"

  FROM transactions t

  JOIN households h
    ON h.id = t.household_id

  JOIN accounts a
    ON a.id = t.account_id
   AND a.household_id = t.household_id

  LEFT JOIN categories c
    ON c.id = t.category_id
   AND (
     c.household_id = t.household_id
     OR c.household_id IS NULL
   )

  LEFT JOIN accounts ta
    ON ta.id = t.transfer_account_id
   AND ta.household_id = t.household_id

  LEFT JOIN credit_card_purchases ccp
    ON ccp.transaction_id = t.id
   AND ccp.household_id = t.household_id

  WHERE t.household_id = $1
`;

const TRANSACTION_FILTERS = `
  AND (
    $2::uuid IS NULL
    OR t.account_id = $2
    OR t.transfer_account_id = $2
  )

  AND (
    $3::uuid IS NULL
    OR t.category_id = $3
  )

  AND (
    $4::varchar IS NULL
    OR t.transaction_type = $4
  )

  AND (
    $5::varchar IS NULL
    OR t.status = $5
  )

  AND (
    $6::date IS NULL
    OR t.occurred_at >= (
      $6::date::timestamp AT TIME ZONE h.time_zone
    )
  )

  AND (
    $7::date IS NULL
    OR t.occurred_at < (
      ($7::date + 1)::timestamp AT TIME ZONE h.time_zone
    )
  )
`;

const TRANSACTION_QUERIES = {
  getHouseholdBaseCurrency: `
    SELECT base_currency_code
    FROM households
    WHERE id = $1
    FOR SHARE
  `,

  lockAccounts: `
    SELECT
      id::text AS id,
      currency_code,
      account_type,
      is_active
    FROM accounts
    WHERE household_id = $1
      AND id = ANY($2::uuid[])
    ORDER BY id
    FOR UPDATE
  `,

  insert: `
    INSERT INTO transactions (
      household_id,
      transaction_type,
      status,
      occurred_at,
      description,
      amount,
      currency_code,
      exchange_rate_to_base,
      amount_base,
      account_id,
      category_id,
      transfer_account_id,
      transfer_amount,
      transfer_currency_code,
      transfer_exchange_rate_to_base,
      transfer_amount_base,
      notes,
      created_by,
      updated_by
    )
    VALUES (
      $1,
      $2,
      $3,
      COALESCE($4::timestamptz, NOW()),
      $5,
      $6,
      $7,
      $8,
      ROUND(
        ROUND($6::numeric, 6) * ROUND($8::numeric, 10),
        6
      ),
      $9,
      $10,
      $11,
      $12,
      $13,
      $14,
      CASE
        WHEN $12::numeric IS NULL THEN NULL
        ELSE ROUND(
               ROUND($12::numeric, 6) * ROUND($14::numeric, 10),
               6
             )
      END,
      $15,
      $16,
      $16
    )
    RETURNING
      id::text AS id,
      transaction_type,
      status,
      occurred_at,
      description,
      amount::text AS amount,
      currency_code,
      exchange_rate_to_base::text AS exchange_rate_to_base,
      amount_base::text AS amount_base,
      account_id::text AS account_id,
      category_id::text AS category_id,
      transfer_account_id::text AS transfer_account_id,
      transfer_amount::text AS transfer_amount,
      transfer_currency_code,
      transfer_exchange_rate_to_base::text AS transfer_exchange_rate_to_base,
      transfer_amount_base::text AS transfer_amount_base,
      notes,
      created_by::text AS created_by,
      created_at
  `,

  createCreditCardPurchase: `
    SELECT public.create_credit_card_purchase_auto(
      $1::uuid,
      $2::smallint,
      $3::uuid
    ) AS purchase_id
  `,

  list: `
    ${TRANSACTION_SELECT}
    ${TRANSACTION_FILTERS}

    ORDER BY
      t.occurred_at DESC,
      t.id DESC

    LIMIT $8
    OFFSET $9
  `,

  count: `
    SELECT COUNT(*)::integer AS total

    FROM transactions t

    JOIN households h
      ON h.id = t.household_id

    WHERE t.household_id = $1
    ${TRANSACTION_FILTERS}
  `,

  getById: `
    ${TRANSACTION_SELECT}
      AND t.id = $2

    LIMIT 1
  `,

  getForUpdate: `
    SELECT
      t.id::text AS id,
      t.transaction_type,
      t.status,
      t.occurred_at,
      t.voided_at,
      t.description,

      t.amount::text AS amount,
      t.currency_code,
      t.exchange_rate_to_base::text AS exchange_rate_to_base,
      t.amount_base::text AS amount_base,

      t.account_id::text AS account_id,
      t.category_id::text AS category_id,

      t.transfer_account_id::text AS transfer_account_id,
      t.transfer_amount::text AS transfer_amount,
      t.transfer_currency_code,
      t.transfer_exchange_rate_to_base::text AS transfer_exchange_rate_to_base,
      t.transfer_amount_base::text AS transfer_amount_base,

      t.notes,

      a.account_type,
      ta.account_type AS transfer_account_type,

      EXISTS (
        SELECT 1
        FROM credit_card_purchases cp
        WHERE cp.transaction_id = t.id
          AND cp.household_id = t.household_id
      ) AS has_credit_card_purchase,

      EXISTS (
        SELECT 1
        FROM credit_card_statement_payments p
        WHERE p.transaction_id = t.id
          AND p.household_id = t.household_id
      ) AS has_card_payment_allocations,
       
      EXISTS (
        SELECT 1
        FROM savings_goal_contributions sgc
        WHERE sgc.transaction_id = t.id
      ) AS has_savings_goal_contribution

    FROM transactions t

    JOIN accounts a
      ON a.id = t.account_id
     AND a.household_id = t.household_id

    LEFT JOIN accounts ta
      ON ta.id = t.transfer_account_id
     AND ta.household_id = t.household_id

    WHERE t.household_id = $1
      AND t.id = $2

    FOR UPDATE OF t
  `,

  update: `
    UPDATE transactions
    SET
      occurred_at = $3::timestamptz,
      description = $4,

      amount = $5::numeric,
      currency_code = $6::char(3),
      exchange_rate_to_base = $7::numeric,

      amount_base = ROUND(
        ROUND($5::numeric, 6) * ROUND($7::numeric, 10),
        6
      ),

      account_id = $8::uuid,
      category_id = $9::uuid,
      status = $10,

      transfer_account_id = $11::uuid,
      transfer_amount = $12::numeric,
      transfer_currency_code = $13::char(3),
      transfer_exchange_rate_to_base = $14::numeric,

      transfer_amount_base = CASE
        WHEN $12::numeric IS NULL THEN NULL
        ELSE ROUND(
          ROUND($12::numeric, 6) * ROUND($14::numeric, 10),
          6
        )
      END,

      notes = $15,
      updated_by = $16

    WHERE household_id = $1
      AND id = $2

    RETURNING id::text AS id
  `,

  void: `
    UPDATE transactions
    SET
      status = 'void',
      voided_at = NOW(),
      updated_by = $3

    WHERE household_id = $1
      AND id = $2
      AND status IN ('pending', 'posted')

    RETURNING
      id::text AS id,
      voided_at
  `,
} as const;

export async function getHouseholdBaseCurrency(
  client: PoolClient,
  householdId: string,
): Promise<HouseholdBaseCurrencyRow | undefined> {
  const result = await client.query<HouseholdBaseCurrencyRow>(
    TRANSACTION_QUERIES.getHouseholdBaseCurrency,
    [householdId],
  );

  return result.rows[0];
}

export async function lockAccounts(
  client: PoolClient,
  householdId: string,
  accountIds: string[],
): Promise<AccountValidationRow[]> {
  const result = await client.query<AccountValidationRow>(
    TRANSACTION_QUERIES.lockAccounts,
    [householdId, accountIds],
  );

  return result.rows;
}

export async function insertTransaction(
  client: PoolClient,
  values: InsertTransactionParams,
): Promise<TransactionRow | undefined> {
  const result = await client.query<TransactionRow>(
    TRANSACTION_QUERIES.insert,
    [
      values.householdId,
      values.transactionType,
      values.status,
      values.occurredAt,
      values.description,
      values.amount,
      values.currencyCode,
      values.exchangeRateToBase,
      values.accountId,
      values.categoryId,
      values.transferAccountId,
      values.transferAmount,
      values.transferCurrencyCode,
      values.transferExchangeRateToBase,
      values.notes,
      values.userId,
    ],
  );

  return result.rows[0];
}

export async function createCreditCardPurchase(
  client: PoolClient,
  transactionId: string,
  installmentsCount: number,
  userId: string,
): Promise<string | undefined> {
  const result = await client.query<CreatedPurchaseRow>(
    TRANSACTION_QUERIES.createCreditCardPurchase,
    [transactionId, installmentsCount, userId],
  );

  return result.rows[0]?.purchase_id;
}

export async function listTransactions(
  householdId: string,
  filters: ListTransactionsQuery,
): Promise<TransactionsListResult> {
  const queryValues = [
    householdId,
    filters.accountId ?? null,
    filters.categoryId ?? null,
    filters.transactionType ?? null,
    filters.status ?? null,
    filters.occurredFrom ?? null,
    filters.occurredTo ?? null,
  ];

  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const [countResult, transactionsResult] = await Promise.all([
    db.query<{ total: number }>(TRANSACTION_QUERIES.count, queryValues),

    db.query<TransactionQueryRow>(TRANSACTION_QUERIES.list, [
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

export async function getTransactionById(
  householdId: string,
  transactionId: string,
): Promise<TransactionQueryRow | undefined> {
  const result = await db.query<TransactionQueryRow>(
    TRANSACTION_QUERIES.getById,
    [householdId, transactionId],
  );

  return result.rows[0];
}

export async function getTransactionForUpdate(
  client: PoolClient,
  householdId: string,
  transactionId: string,
): Promise<TransactionForUpdateRow | undefined> {
  const result = await client.query<TransactionForUpdateRow>(
    TRANSACTION_QUERIES.getForUpdate,
    [householdId, transactionId],
  );

  return result.rows[0];
}

export interface UpdateTransactionParams {
  occurredAt: string;
  description: string | null;

  amount: number;
  currencyCode: CurrencyCode;
  exchangeRateToBase: number;

  accountId: string;
  categoryId: string | null;
  status: TransactionStatus;

  transferAccountId: string | null;
  transferAmount: number | null;
  transferCurrencyCode: CurrencyCode | null;
  transferExchangeRateToBase: number | null;

  notes: string | null;
  userId: string;
}

export async function updateTransaction(
  client: PoolClient,
  householdId: string,
  transactionId: string,
  values: UpdateTransactionParams,
): Promise<boolean> {
  const result = await client.query<{ id: string }>(
    TRANSACTION_QUERIES.update,
    [
      householdId,
      transactionId,
      values.occurredAt,
      values.description,
      values.amount,
      values.currencyCode,
      values.exchangeRateToBase,
      values.accountId,
      values.categoryId,
      values.status,
      values.transferAccountId,
      values.transferAmount,
      values.transferCurrencyCode,
      values.transferExchangeRateToBase,
      values.notes,
      values.userId,
    ],
  );

  return result.rows.length > 0;
}

export async function getTransactionByIdWithClient(
  client: PoolClient,
  householdId: string,
  transactionId: string,
): Promise<TransactionQueryRow | undefined> {
  const result = await client.query<TransactionQueryRow>(
    TRANSACTION_QUERIES.getById,
    [householdId, transactionId],
  );

  return result.rows[0];
}

export async function voidTransaction(
  client: PoolClient,
  householdId: string,
  transactionId: string,
  userId: string,
): Promise<{ id: string; voided_at: Date } | undefined> {
  const result = await client.query<{
    id: string;
    voided_at: Date;
  }>(TRANSACTION_QUERIES.void, [householdId, transactionId, userId]);

  return result.rows[0];
}
