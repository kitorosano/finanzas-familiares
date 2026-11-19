import type { PoolClient } from 'pg';

import { db } from '../../db/pool.js';
import type { HouseholdBaseCurrencyRow } from '../../types/household.js';
import type { AccountValidationRow } from '../accounts/account.types.js';
import type { TransactionRow } from '../transactions/transaction.types.js';

import type {
  AllocationSummaryRow,
  CreatedTransactionIdRow,
  CreditCardPaymentAllocation,
  CreditCardPositionRow,
  CreditCardRow,
  CreditCardStatementInstallment,
  CreditCardStatementPayment,
  CreditCardStatementRow,
  ListCreditCardsQuery,
  ListCreditCardStatementsQuery,
} from './credit-card.types.js';

const CREDIT_CARD_QUERIES = {
  lockCardAccount: `
    SELECT
      id::text AS id,
      account_type,
      currency_code,
      is_active
    FROM accounts
    WHERE id = $1
      AND household_id = $2
      AND account_type = 'credit_card'
    FOR UPDATE
  `,
  lockSourceAccount: `
    SELECT
      id::text AS id,
      account_type,
      currency_code,
      is_active
    FROM accounts
    WHERE id = $1
      AND household_id = $2
    FOR UPDATE
  `,
  getHouseholdBaseCurrency: `
    SELECT base_currency_code
    FROM households
    WHERE id = $1
  `,
  payCard: `
    SELECT public.pay_credit_card(
      $1::uuid,
      $2::uuid,
      $3::numeric,
      $4::numeric,
      $5::timestamptz,
      $6::uuid,
      $7::text
    ) AS transaction_id
  `,
  getPaymentTransaction: `
    SELECT
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
    FROM transactions
    WHERE id = $1
      AND household_id = $2
  `,
  listPaymentAllocations: `
    SELECT
      p.statement_id::text AS "statementId",
      s.period_start::text AS "periodStart",
      s.period_end::text AS "periodEnd",
      s.closing_date::text AS "closingDate",
      s.due_date::text AS "dueDate",
      p.amount::text AS amount
    FROM credit_card_statement_payments p
    JOIN credit_card_statements s
      ON s.id = p.statement_id
     AND s.household_id = p.household_id
    WHERE p.transaction_id = $1
      AND p.household_id = $2
    ORDER BY s.due_date, s.closing_date, s.id
  `,
  getAllocationSummary: `
    SELECT
      COALESCE(SUM(amount), 0)::numeric(20,6)::text
        AS allocated_amount,
      GREATEST(
        $3::numeric - COALESCE(SUM(amount), 0),
        0
      )::numeric(20,6)::text AS unapplied_advance
    FROM credit_card_statement_payments
    WHERE transaction_id = $1
      AND household_id = $2
  `,
  getPosition: `
    SELECT
      signed_balance::text AS signed_balance,
      debt_balance::text AS debt_balance,
      credit_balance::text AS credit_balance,
      outstanding_statement_balance::text
        AS outstanding_statement_balance,
      unapplied_advances::text AS unapplied_advances
    FROM credit_card_account_positions
    WHERE account_id = $1
      AND household_id = $2
  `,
  list: `
    SELECT
      a.id::text AS id,
      a.name,
      a.institution,
      a.currency_code AS "currencyCode",

      a.holder_user_id::text AS "holderUserId",
      u.display_name AS "holderName",

      a.is_active AS "isActive",
      a.include_in_net_worth AS "includeInNetWorth",
      a.credit_limit::text AS "creditLimit",

      a.statement_closing_day AS "statementClosingDay",
      a.payment_due_day AS "paymentDueDay",
      a.payment_due_month_offset AS "paymentDueMonthOffset",

      ab.balance::text AS balance,
      ab.base_currency_code AS "baseCurrencyCode",
      ab.exchange_rate_to_base::text AS "exchangeRateToBase",
      ab.balance_base::text AS "balanceBase",
      ab.conversion_status AS "conversionStatus",

      cp.signed_balance::text AS "signedBalance",
      cp.debt_balance::text AS "debtBalance",
      cp.credit_balance::text AS "creditBalance",
      cp.outstanding_statement_balance::text
        AS "outstandingStatementBalance",
      cp.unapplied_advances::text AS "unappliedAdvances"

    FROM accounts a

    JOIN account_balances ab
      ON ab.account_id = a.id
     AND ab.household_id = a.household_id

    JOIN credit_card_account_positions cp
      ON cp.account_id = a.id
     AND cp.household_id = a.household_id

    LEFT JOIN users u
      ON u.id = a.holder_user_id

    WHERE a.household_id = $1
      AND a.account_type = 'credit_card'
      AND ($2::char(3) IS NULL OR a.currency_code = $2)
      AND ($3::boolean OR a.is_active = TRUE)

    ORDER BY a.currency_code, a.name, a.id
  `,
  countStatements: `
    SELECT COUNT(*)::integer AS total
    FROM credit_card_statement_balances b

    WHERE b.household_id = $1
      AND b.account_id = $2
      AND ($3::varchar IS NULL OR b.payment_status = $3)
      AND ($4::date IS NULL OR b.due_date >= $4::date)
      AND ($5::date IS NULL OR b.due_date <= $5::date)
  `,
  listStatements: `
    SELECT
      s.id::text AS id,
      s.account_id::text AS "accountId",
      s.period_start::text AS "periodStart",
      s.period_end::text AS "periodEnd",
      s.closing_date::text AS "closingDate",
      s.due_date::text AS "dueDate",

      b.total_due::text AS "totalDue",
      b.amount_paid::text AS "amountPaid",
      b.outstanding_amount::text AS "outstandingAmount",
      b.payment_status AS "paymentStatus",

      COALESCE(i.installment_count, 0)::integer
        AS "installmentCount",

      COALESCE(p.payment_count, 0)::integer
        AS "paymentCount",

      s.notes,
      s.created_at AS "createdAt"

    FROM credit_card_statements s

    JOIN credit_card_statement_balances b
      ON b.statement_id = s.id
     AND b.household_id = s.household_id

    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS installment_count
      FROM credit_card_installments ci
      WHERE ci.statement_id = s.id
        AND ci.household_id = s.household_id
    ) i ON TRUE

    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS payment_count
      FROM credit_card_statement_payments cp
      WHERE cp.statement_id = s.id
        AND cp.household_id = s.household_id
    ) p ON TRUE

    WHERE s.household_id = $1
      AND s.account_id = $2
      AND ($3::varchar IS NULL OR b.payment_status = $3)
      AND ($4::date IS NULL OR s.due_date >= $4::date)
      AND ($5::date IS NULL OR s.due_date <= $5::date)

    ORDER BY s.due_date, s.closing_date, s.id

    LIMIT $6
    OFFSET $7
  `,
  getStatement: `
    SELECT
      s.id::text AS id,
      s.account_id::text AS "accountId",
      s.period_start::text AS "periodStart",
      s.period_end::text AS "periodEnd",
      s.closing_date::text AS "closingDate",
      s.due_date::text AS "dueDate",

      b.total_due::text AS "totalDue",
      b.amount_paid::text AS "amountPaid",
      b.outstanding_amount::text AS "outstandingAmount",
      b.payment_status AS "paymentStatus",

      (
        SELECT COUNT(*)::integer
        FROM credit_card_installments i
        WHERE i.statement_id = s.id
          AND i.household_id = s.household_id
      ) AS "installmentCount",

      (
        SELECT COUNT(*)::integer
        FROM credit_card_statement_payments p
        WHERE p.statement_id = s.id
          AND p.household_id = s.household_id
      ) AS "paymentCount",

      s.notes,
      s.created_at AS "createdAt"

    FROM credit_card_statements s

    JOIN credit_card_statement_balances b
      ON b.statement_id = s.id
     AND b.household_id = s.household_id

    WHERE s.id = $1
      AND s.account_id = $2
      AND s.household_id = $3

    LIMIT 1
  `,
  listInstallments: `
    SELECT
      i.id::text AS id,
      i.purchase_id::text AS "purchaseId",
      i.installment_number AS "installmentNumber",
      i.due_date::text AS "dueDate",
      i.amount::text AS amount,

      p.installments_count AS "purchaseInstallmentsCount",
      p.first_due_date::text AS "purchaseFirstDueDate",

      t.id::text AS "transactionId",
      t.description AS "purchaseDescription",
      t.occurred_at AS "purchaseOccurredAt",
      t.amount::text AS "purchaseAmount",

      c.name AS "categoryName"

    FROM credit_card_installments i

    JOIN credit_card_purchases p
      ON p.id = i.purchase_id
     AND p.household_id = i.household_id

    JOIN transactions t
      ON t.id = p.transaction_id
     AND t.household_id = p.household_id

    LEFT JOIN categories c
      ON c.id = t.category_id

    WHERE i.statement_id = $1
      AND i.household_id = $2

    ORDER BY
      i.due_date,
      t.occurred_at,
      i.purchase_id,
      i.installment_number
  `,
  listStatementPayments: `
    SELECT
      p.id::text AS id,
      p.transaction_id::text AS "transactionId",
      p.amount::text AS amount,
      p.notes,
      p.created_at AS "createdAt",

      t.description AS "paymentDescription",
      t.occurred_at AS "paymentOccurredAt",
      t.transfer_amount::text AS "transferAmount",

      t.account_id::text AS "sourceAccountId",
      source.name AS "sourceAccountName"

    FROM credit_card_statement_payments p

    JOIN transactions t
      ON t.id = p.transaction_id
     AND t.household_id = p.household_id

    JOIN accounts source
      ON source.id = t.account_id
     AND source.household_id = t.household_id

    WHERE p.statement_id = $1
      AND p.household_id = $2

    ORDER BY p.created_at, p.id
  `,
} as const;

export async function lockCardAccount(
  client: PoolClient,
  cardAccountId: string,
  householdId: string,
): Promise<AccountValidationRow | undefined> {
  const result = await client.query<AccountValidationRow>(
    CREDIT_CARD_QUERIES.lockCardAccount,
    [cardAccountId, householdId],
  );

  return result.rows[0];
}

export async function lockSourceAccount(
  client: PoolClient,
  sourceAccountId: string,
  householdId: string,
): Promise<AccountValidationRow | undefined> {
  const result = await client.query<AccountValidationRow>(
    CREDIT_CARD_QUERIES.lockSourceAccount,
    [sourceAccountId, householdId],
  );

  return result.rows[0];
}

export async function getHouseholdBaseCurrency(
  client: PoolClient,
  householdId: string,
): Promise<HouseholdBaseCurrencyRow | undefined> {
  const result = await client.query<HouseholdBaseCurrencyRow>(
    CREDIT_CARD_QUERIES.getHouseholdBaseCurrency,
    [householdId],
  );

  return result.rows[0];
}

export async function payCreditCard(
  client: PoolClient,
  values: {
    cardAccountId: string;
    sourceAccountId: string;
    amount: number;
    exchangeRateToBase: number;
    occurredAt: string;
    userId: string;
    notes: string | null;
  },
): Promise<string | undefined> {
  const result = await client.query<CreatedTransactionIdRow>(
    CREDIT_CARD_QUERIES.payCard,
    [
      values.cardAccountId,
      values.sourceAccountId,
      values.amount,
      values.exchangeRateToBase,
      values.occurredAt,
      values.userId,
      values.notes,
    ],
  );

  return result.rows[0]?.transaction_id;
}

export async function getPaymentTransaction(
  client: PoolClient,
  transactionId: string,
  householdId: string,
): Promise<TransactionRow | undefined> {
  const result = await client.query<TransactionRow>(
    CREDIT_CARD_QUERIES.getPaymentTransaction,
    [transactionId, householdId],
  );

  return result.rows[0];
}

export async function listPaymentAllocations(
  client: PoolClient,
  transactionId: string,
  householdId: string,
): Promise<CreditCardPaymentAllocation[]> {
  const result = await client.query<CreditCardPaymentAllocation>(
    CREDIT_CARD_QUERIES.listPaymentAllocations,
    [transactionId, householdId],
  );

  return result.rows;
}

export async function getAllocationSummary(
  client: PoolClient,
  transactionId: string,
  householdId: string,
  transferAmount: string | null,
): Promise<AllocationSummaryRow | undefined> {
  const result = await client.query<AllocationSummaryRow>(
    CREDIT_CARD_QUERIES.getAllocationSummary,
    [transactionId, householdId, transferAmount],
  );

  return result.rows[0];
}

export async function getPosition(
  client: PoolClient,
  cardAccountId: string,
  householdId: string,
): Promise<CreditCardPositionRow | undefined> {
  const result = await client.query<CreditCardPositionRow>(
    CREDIT_CARD_QUERIES.getPosition,
    [cardAccountId, householdId],
  );

  return result.rows[0];
}

export async function listCreditCards(
  householdId: string,
  filters: ListCreditCardsQuery,
): Promise<CreditCardRow[]> {
  const result = await db.query<CreditCardRow>(CREDIT_CARD_QUERIES.list, [
    householdId,
    filters.currencyCode ?? null,
    filters.includeInactive ?? false,
  ]);

  return result.rows;
}

export async function countStatements(
  householdId: string,
  cardAccountId: string,
  filters: ListCreditCardStatementsQuery,
): Promise<number> {
  const result = await db.query<{ total: number }>(
    CREDIT_CARD_QUERIES.countStatements,
    [
      householdId,
      cardAccountId,
      filters.status ?? null,
      filters.dueFrom ?? null,
      filters.dueTo ?? null,
    ],
  );

  return result.rows[0]?.total ?? 0;
}

export async function listStatements(
  householdId: string,
  cardAccountId: string,
  filters: ListCreditCardStatementsQuery,
  limit: number,
  offset: number,
): Promise<CreditCardStatementRow[]> {
  const result = await db.query<CreditCardStatementRow>(
    CREDIT_CARD_QUERIES.listStatements,
    [
      householdId,
      cardAccountId,
      filters.status ?? null,
      filters.dueFrom ?? null,
      filters.dueTo ?? null,
      limit,
      offset,
    ],
  );

  return result.rows;
}

export async function getStatement(
  householdId: string,
  cardAccountId: string,
  statementId: string,
): Promise<CreditCardStatementRow | undefined> {
  const result = await db.query<CreditCardStatementRow>(
    CREDIT_CARD_QUERIES.getStatement,
    [statementId, cardAccountId, householdId],
  );

  return result.rows[0];
}

export async function listStatementInstallments(
  householdId: string,
  statementId: string,
): Promise<CreditCardStatementInstallment[]> {
  const result = await db.query<CreditCardStatementInstallment>(
    CREDIT_CARD_QUERIES.listInstallments,
    [statementId, householdId],
  );

  return result.rows;
}

export async function listStatementPayments(
  householdId: string,
  statementId: string,
): Promise<CreditCardStatementPayment[]> {
  const result = await db.query<CreditCardStatementPayment>(
    CREDIT_CARD_QUERIES.listStatementPayments,
    [statementId, householdId],
  );

  return result.rows;
}
