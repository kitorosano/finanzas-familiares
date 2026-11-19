import type { FastifyRequest } from 'fastify';

import { withTransaction } from '../../db/transaction.js';
import { AppError } from '../../errors/app-error.js';

import { writeAuditLog } from '../audit/audit.service.js';
import { getHouseholdScope } from '../authorization/household-context.js';

import type { TransactionRow } from '../transactions/transaction.types.js';

import type {
  CreditCardPaymentAllocation,
  CreditCardPaymentResult,
  CreditCardPosition,
  PayCreditCardBody,
  PayCreditCardParams,
} from './credit-card.types.js';

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
