import type { PoolClient } from 'pg';

import type { HouseholdBaseCurrencyRow } from '../../types/household.js';
import type { CurrencyCode } from '../../types/money.js';
import type { AccountValidationRow } from '../accounts/account.types.js';

import type {
  CreatedPurchaseRow,
  CreateTransactionBody,
  TransactionRow,
  TransactionStatus,
  TransactionType,
} from './transaction.types.js';

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

export interface InsertTransactionParams {
  householdId: string;
  transactionType: TransactionType;
  status: TransactionStatus;
  occurredAt: string | null;
  description: string | null;
  amount: number;
  currencyCode: CurrencyCode;
  exchangeRateToBase: number;
  accountId: string;
  categoryId: string | null;
  transferAccountId: string | null;
  transferAmount: number | null;
  transferCurrencyCode: CurrencyCode | null;
  transferExchangeRateToBase: number | null;
  notes: string | null;
  userId: string;
}

export async function insertTransaction(
  client: PoolClient,
  values: InsertTransactionParams,
): Promise<TransactionRow | undefined> {
  const result = await client.query<TransactionRow>(TRANSACTION_QUERIES.insert, [
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
  ]);

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
