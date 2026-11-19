import type { FastifyRequest } from 'fastify';

import { withTransaction } from '../../db/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { ERROR_CODES } from '../../errors/error-codes.js';
import type { CurrencyCode } from '../../types/money.js';
import { isPositiveFiniteNumber } from '../../utils/validation.js';

import { setAuditActor } from '../audit/audit-context.js';
import { writeAuditLog } from '../audit/audit.db.js';
import type { HouseholdScope } from '../authorization/authorization.types.js';
import { getHouseholdScope } from '../authorization/household-context.js';

import {
  getAllocationSummary as getAllocationSummaryFromDb,
  getHouseholdBaseCurrency as getHouseholdBaseCurrencyFromDb,
  getPaymentTransaction as getPaymentTransactionFromDb,
  getPosition as getPositionFromDb,
  getStatement as getStatementFromDb,
  listCreditCards as listCreditCardsFromDb,
  listPaymentAllocations as listPaymentAllocationsFromDb,
  listStatementInstallments,
  listStatementPayments,
  lockCardAccount,
  lockSourceAccount,
  payCreditCard as payCreditCardInDb,
  countStatements as countCreditCardStatements,
  listStatements,
} from './credit-card.db.js';
import type {
  CreditCardPaymentResult,
  CreditCardPosition,
  CreditCardRow,
  CreditCardStatementDetailResult,
  CreditCardStatementsResult,
  ListCreditCardsQuery,
  ListCreditCardStatementsQuery,
  PayCreditCardBody,
  PayCreditCardParams,
} from './credit-card.types.js';

function resolveExchangeRate(
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
    if (!isPositiveFiniteNumber(body.amount)) {
      throw new AppError(
        400,
        ERROR_CODES.INVALID_PAYMENT_AMOUNT,
        'El importe del pago debe ser mayor que cero',
      );
    }

    // 2. Lock and validate the credit card within the authenticated household.
    const card = await lockCardAccount(client, cardAccountId, scope.householdId);

    if (!card) {
      throw new AppError(
        404,
        ERROR_CODES.CREDIT_CARD_NOT_FOUND,
        'No se encontró la tarjeta de crédito en el hogar',
      );
    }

    if (!card.is_active) {
      throw new AppError(
        400,
        ERROR_CODES.CREDIT_CARD_INACTIVE,
        'La tarjeta de crédito está inactiva',
      );
    }

    // 3. Lock and validate the source account.
    const source = await lockSourceAccount(
      client,
      body.sourceAccountId,
      scope.householdId,
    );

    if (!source) {
      throw new AppError(
        404,
        ERROR_CODES.SOURCE_ACCOUNT_NOT_FOUND,
        'No se encontró la cuenta de origen en el hogar',
      );
    }

    if (!source.is_active) {
      throw new AppError(
        400,
        ERROR_CODES.SOURCE_ACCOUNT_INACTIVE,
        'La cuenta de origen está inactiva',
      );
    }

    if (source.account_type === 'credit_card') {
      throw new AppError(
        400,
        ERROR_CODES.INVALID_SOURCE_ACCOUNT,
        'La cuenta de origen no puede ser otra tarjeta de crédito',
      );
    }

    if (source.id === card.id) {
      throw new AppError(
        400,
        ERROR_CODES.INVALID_SOURCE_ACCOUNT,
        'La cuenta de origen y la tarjeta deben ser diferentes',
      );
    }

    // 4. Both accounts must use the same currency.
    if (source.currency_code !== card.currency_code) {
      throw new AppError(
        400,
        ERROR_CODES.CURRENCY_MISMATCH,
        'La cuenta de origen y la tarjeta deben utilizar la misma moneda',
      );
    }

    // 5. Resolve the historical exchange rate against household base currency.
    const household = await getHouseholdBaseCurrencyFromDb(
      client,
      scope.householdId,
    );

    if (!household) {
      throw new AppError(
        404,
        ERROR_CODES.HOUSEHOLD_NOT_FOUND,
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
    const transactionId = await payCreditCardInDb(client, {
      cardAccountId: card.id,
      sourceAccountId: source.id,
      amount: body.amount,
      exchangeRateToBase: exchangeRate,
      occurredAt,
      userId: scope.userId,
      notes: body.notes ?? null,
    });

    if (!transactionId) {
      throw new Error(
        'Credit card payment function did not return a transaction ID',
      );
    }

    // 7. Retrieve the created transfer.
    const transaction = await getPaymentTransactionFromDb(
      client,
      transactionId,
      scope.householdId,
    );

    if (!transaction) {
      throw new Error('Credit card payment transaction could not be retrieved');
    }

    // 8. Retrieve allocations made by the database function.
    const allocations = await listPaymentAllocationsFromDb(
      client,
      transactionId,
      scope.householdId,
    );

    // 9. Calculate the portion of this payment that remains as an advance.
    // Keep the calculation in PostgreSQL to avoid floating-point arithmetic.
    const allocationSummary = await getAllocationSummaryFromDb(
      client,
      transactionId,
      scope.householdId,
      transaction.transfer_amount,
    );

    if (!allocationSummary) {
      throw new Error('Credit card payment allocation summary is missing');
    }

    // 10. Get the current card position after payment allocation.
    const position = await getPositionFromDb(
      client,
      card.id,
      scope.householdId,
    );

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
  return listCreditCardsFromDb(scope.householdId, filters);
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
      ERROR_CODES.CREDIT_CARD_NOT_FOUND,
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
      ERROR_CODES.INVALID_DUE_DATE_RANGE,
      'La fecha inicial no puede ser posterior a la fecha final',
    );
  }

  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const total = await countCreditCardStatements(
    scope.householdId,
    cardAccountId,
    filters,
  );

  const data = await listStatements(
    scope.householdId,
    cardAccountId,
    filters,
    limit,
    offset,
  );

  return {
    data,
    pagination: {
      limit,
      offset,
      total,
    },
  };
}

export async function getCreditCardStatementDetail(
  scope: HouseholdScope,
  cardAccountId: string,
  statementId: string,
): Promise<CreditCardStatementDetailResult> {
  await getCreditCardById(scope, cardAccountId);

  const statement = await getStatementFromDb(
    scope.householdId,
    cardAccountId,
    statementId,
  );

  if (!statement) {
    throw new AppError(
      404,
      ERROR_CODES.CREDIT_CARD_STATEMENT_NOT_FOUND,
      'No se encontró el estado de cuenta de esta tarjeta',
    );
  }

  const installments = await listStatementInstallments(
    scope.householdId,
    statementId,
  );

  const payments = await listStatementPayments(
    scope.householdId,
    statementId,
  );

  return {
    statement,
    installments,
    payments,
  };
}
