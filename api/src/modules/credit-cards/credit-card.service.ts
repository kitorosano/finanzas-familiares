import type { FastifyRequest } from 'fastify';

import { withTransaction } from '../../db/transaction.js';
import { AppError } from '../../errors/app-error.js';

import { setAuditActor } from '../audit/audit-context.js';
import { writeAuditLog } from '../audit/audit.service.js';
import {
  getHouseholdScope,
  type HouseholdScope,
} from '../authorization/household-context.js';

import type { TransactionRow } from '../transactions/transaction.types.js';

import type {
  CreditCardPaymentAllocation,
  CreditCardPaymentResult,
  CreditCardPosition,
  CreditCardRow,
  CreditCardStatementDetailResult,
  CreditCardStatementInstallment,
  CreditCardStatementPayment,
  CreditCardStatementRow,
  CreditCardStatementsResult,
  ListCreditCardsQuery,
  ListCreditCardStatementsQuery,
  PayCreditCardBody,
  PayCreditCardParams,
} from './credit-card.types.js';

import { db } from '../../db.js';

interface AccountRow {
  id: string;
  account_type: string;
  currency_code: string;
  is_active: boolean;
}

interface HouseholdRow {
  base_currency_code: string;
}

interface CreatedTransactionIdRow {
  transaction_id: string;
}

interface AllocationRow extends CreditCardPaymentAllocation {}

interface AllocationSummaryRow {
  allocated_amount: string;
  unapplied_advance: string;
}

interface CreditCardPositionRow {
  signed_balance: string;
  debt_balance: string;
  credit_balance: string;
  outstanding_statement_balance: string;
  unapplied_advances: string;
}

function resolveExchangeRate(
  suppliedRate: number | undefined,
  currencyCode: string,
  baseCurrencyCode: string,
): number {
  if (currencyCode === baseCurrencyCode) {
    if (suppliedRate !== undefined && suppliedRate !== 1) {
      throw new AppError(
        400,
        'INVALID_EXCHANGE_RATE',
        `La tasa de cambio debe ser 1 para la moneda base (${baseCurrencyCode})`,
      );
    }

    return 1;
  }

  if (
    suppliedRate === undefined ||
    !Number.isFinite(suppliedRate) ||
    suppliedRate <= 0
  ) {
    throw new AppError(
      400,
      'EXCHANGE_RATE_REQUIRED',
      `Se requiere una tasa de cambio válida para ${currencyCode}`,
    );
  }

  return suppliedRate;
}

export async function payCreditCard(
  request: FastifyRequest<{
    Params: PayCreditCardParams;
    Body: PayCreditCardBody;
  }>,
): Promise<CreditCardPaymentResult> {
  const scope = getHouseholdScope(request);

  const { cardAccountId } = request.params;
  const body = request.body;

  return withTransaction(async (client) => {
    await setAuditActor(client, scope.userId);

    // 1. Validate amount before touching financial records.
    if (!Number.isFinite(body.amount) || body.amount <= 0) {
      throw new AppError(
        400,
        'INVALID_PAYMENT_AMOUNT',
        'El importe del pago debe ser mayor que cero',
      );
    }

    // 2. Lock and validate the credit card within the authenticated household.
    const cardResult = await client.query<AccountRow>(
      `
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
      [cardAccountId, scope.householdId],
    );

    const card = cardResult.rows[0];

    if (!card) {
      throw new AppError(
        404,
        'CREDIT_CARD_NOT_FOUND',
        'No se encontró la tarjeta de crédito en el hogar',
      );
    }

    if (!card.is_active) {
      throw new AppError(
        400,
        'CREDIT_CARD_INACTIVE',
        'La tarjeta de crédito está inactiva',
      );
    }

    // 3. Lock and validate the source account.
    const sourceResult = await client.query<AccountRow>(
      `
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
      [body.sourceAccountId, scope.householdId],
    );

    const source = sourceResult.rows[0];

    if (!source) {
      throw new AppError(
        404,
        'SOURCE_ACCOUNT_NOT_FOUND',
        'No se encontró la cuenta de origen en el hogar',
      );
    }

    if (!source.is_active) {
      throw new AppError(
        400,
        'SOURCE_ACCOUNT_INACTIVE',
        'La cuenta de origen está inactiva',
      );
    }

    if (source.account_type === 'credit_card') {
      throw new AppError(
        400,
        'INVALID_SOURCE_ACCOUNT',
        'La cuenta de origen no puede ser otra tarjeta de crédito',
      );
    }

    if (source.id === card.id) {
      throw new AppError(
        400,
        'INVALID_SOURCE_ACCOUNT',
        'La cuenta de origen y la tarjeta deben ser diferentes',
      );
    }

    // 4. Both accounts must use the same currency.
    if (source.currency_code !== card.currency_code) {
      throw new AppError(
        400,
        'CURRENCY_MISMATCH',
        'La cuenta de origen y la tarjeta deben utilizar la misma moneda',
      );
    }

    // 5. Resolve the historical exchange rate against household base currency.
    const householdResult = await client.query<HouseholdRow>(
      `
        SELECT base_currency_code
        FROM households
        WHERE id = $1
      `,
      [scope.householdId],
    );

    const household = householdResult.rows[0];

    if (!household) {
      throw new AppError(
        404,
        'HOUSEHOLD_NOT_FOUND',
        'No se encontró el hogar de la sesión',
      );
    }

    const exchangeRate = resolveExchangeRate(
      body.exchangeRateToBase,
      card.currency_code,
      household.base_currency_code,
    );

    const occurredAt = body.occurredAt ?? new Date().toISOString();

    // 6. Delegate payment allocation and advance handling to PostgreSQL.
    const paymentResult = await client.query<CreatedTransactionIdRow>(
      `
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
      [
        card.id,
        source.id,
        body.amount,
        exchangeRate,
        occurredAt,
        scope.userId,
        body.notes ?? null,
      ],
    );

    const transactionId = paymentResult.rows[0]?.transaction_id;

    if (!transactionId) {
      throw new Error(
        'Credit card payment function did not return a transaction ID',
      );
    }

    // 7. Retrieve the created transfer.
    const transactionResult = await client.query<TransactionRow>(
      `
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
      [transactionId, scope.householdId],
    );

    const transaction = transactionResult.rows[0];

    if (!transaction) {
      throw new Error('Credit card payment transaction could not be retrieved');
    }

    // 8. Retrieve allocations made by the database function.
    const allocationsResult = await client.query<AllocationRow>(
      `
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
      [transactionId, scope.householdId],
    );

    const allocations = allocationsResult.rows;

    // 9. Calculate the portion of this payment that remains as an advance.
    // Keep the calculation in PostgreSQL to avoid floating-point arithmetic.
    const summaryResult = await client.query<AllocationSummaryRow>(
      `
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
      [transactionId, scope.householdId, transaction.transfer_amount],
    );

    const allocationSummary = summaryResult.rows[0];

    if (!allocationSummary) {
      throw new Error('Credit card payment allocation summary is missing');
    }

    // 10. Get the current card position after payment allocation.
    const positionResult = await client.query<CreditCardPositionRow>(
      `
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
      [card.id, scope.householdId],
    );

    const position = positionResult.rows[0];

    if (!position) {
      throw new Error('Credit card position could not be retrieved');
    }

    const cardPosition: CreditCardPosition = {
      signedBalance: position.signed_balance,
      debtBalance: position.debt_balance,
      creditBalance: position.credit_balance,
      outstandingStatementBalance: position.outstanding_statement_balance,
      unappliedAdvances: position.unapplied_advances,
    };

    // 11. Audit the transfer and its actual allocation in the same transaction.
    await writeAuditLog(client, scope, {
      action: 'create',
      entityName: 'transactions',
      entityId: transaction.id,
      newValues: {
        transactionType: 'transfer',
        purpose: 'credit_card_payment',
        status: transaction.status,
        cardAccountId: card.id,
        sourceAccountId: source.id,
        amount: transaction.amount,
        currencyCode: transaction.currency_code,
        exchangeRateToBase: transaction.exchange_rate_to_base,
        amountBase: transaction.amount_base,
        occurredAt: transaction.occurred_at.toISOString(),
        notes: transaction.notes,
        allocations,
        allocatedAmount: allocationSummary.allocated_amount,
        unappliedAdvance: allocationSummary.unapplied_advance,
        cardPosition,
      },
    });

    return {
      transaction,
      allocations,
      allocatedAmount: allocationSummary.allocated_amount,
      unappliedAdvance: allocationSummary.unapplied_advance,
      cardPosition,
    };
  });
}

export async function listCreditCards(
  scope: HouseholdScope,
  filters: ListCreditCardsQuery,
): Promise<CreditCardRow[]> {
  const result = await db.query<CreditCardRow>(
    `
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
    [
      scope.householdId,
      filters.currencyCode ?? null,
      filters.includeInactive ?? false,
    ],
  );

  return result.rows;
}

export async function getCreditCardById(
  scope: HouseholdScope,
  cardAccountId: string,
): Promise<CreditCardRow> {
  const result = await listCreditCards(scope, {
    includeInactive: true,
  });

  const card = result.find((item) => item.id === cardAccountId);

  if (!card) {
    throw new AppError(
      404,
      'CREDIT_CARD_NOT_FOUND',
      'No se encontró la tarjeta de crédito en el hogar',
    );
  }

  return card;
}

export async function listCreditCardStatements(
  scope: HouseholdScope,
  cardAccountId: string,
  filters: ListCreditCardStatementsQuery,
): Promise<CreditCardStatementsResult> {
  await getCreditCardById(scope, cardAccountId);

  if (filters.dueFrom && filters.dueTo && filters.dueFrom > filters.dueTo) {
    throw new AppError(
      400,
      'INVALID_DUE_DATE_RANGE',
      'La fecha inicial no puede ser posterior a la fecha final',
    );
  }

  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const filterValues = [
    scope.householdId,
    cardAccountId,
    filters.status ?? null,
    filters.dueFrom ?? null,
    filters.dueTo ?? null,
  ];

  const countResult = await db.query<{ total: number }>(
    `
      SELECT COUNT(*)::integer AS total
      FROM credit_card_statement_balances b

      WHERE b.household_id = $1
        AND b.account_id = $2
        AND ($3::varchar IS NULL OR b.payment_status = $3)
        AND ($4::date IS NULL OR b.due_date >= $4::date)
        AND ($5::date IS NULL OR b.due_date <= $5::date)
    `,
    filterValues,
  );

  const statementsResult = await db.query<CreditCardStatementRow>(
    `
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
    [...filterValues, limit, offset],
  );

  return {
    data: statementsResult.rows,
    pagination: {
      limit,
      offset,
      total: countResult.rows[0]?.total ?? 0,
    },
  };
}

export async function getCreditCardStatementDetail(
  scope: HouseholdScope,
  cardAccountId: string,
  statementId: string,
): Promise<CreditCardStatementDetailResult> {
  await getCreditCardById(scope, cardAccountId);

  const statementResult = await db.query<CreditCardStatementRow>(
    `
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
    [statementId, cardAccountId, scope.householdId],
  );

  const statement = statementResult.rows[0];

  if (!statement) {
    throw new AppError(
      404,
      'CREDIT_CARD_STATEMENT_NOT_FOUND',
      'No se encontró el estado de cuenta de esta tarjeta',
    );
  }

  const installmentsResult = await db.query<CreditCardStatementInstallment>(
    `
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
    [statementId, scope.householdId],
  );

  const paymentsResult = await db.query<CreditCardStatementPayment>(
    `
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
    [statementId, scope.householdId],
  );

  return {
    statement,
    installments: installmentsResult.rows,
    payments: paymentsResult.rows,
  };
}
