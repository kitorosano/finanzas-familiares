import { withTransaction } from '../../db/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { ERROR_CODES } from '../../errors/error-codes.js';
import type { CurrencyCode } from '../../types/money.js';
import { isPositiveFiniteNumber } from '../../utils/validation.js';

import type { AccountValidationRow } from '../accounts/account.types.js';
import { setAuditActor } from '../audit/audit-context.js';
import { writeAuditLog } from '../audit/audit.db.js';
import { getHouseholdScope } from '../authorization/household-context.js';
import { getActiveCategories } from '../categories/category.db.js';

import type { FastifyRequest } from 'fastify';
import {
  createCreditCardPurchase,
  getHouseholdBaseCurrency,
  insertTransaction,
  lockAccounts,
} from './transaction.db.js';
import type {
  CreateTransactionBody,
  CreateTransactionResult,
  TransactionStatus,
} from './transaction.types.js';

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

export async function createTransaction(
  request: FastifyRequest,
  body: CreateTransactionBody,
): Promise<CreateTransactionResult> {
  const scope = getHouseholdScope(request);

  return withTransaction(async (client) => {
    await setAuditActor(client, scope.userId);

    const household = await getHouseholdBaseCurrency(client, scope.householdId);

    if (!household) {
      throw new AppError(
        404,
        ERROR_CODES.HOUSEHOLD_NOT_FOUND,
        'No se encontró el hogar de la sesión',
      );
    }

    const isTransfer = body.transactionType === 'transfer';

    if (isTransfer && body.accountId === body.transferAccountId) {
      throw new AppError(
        400,
        ERROR_CODES.INVALID_TRANSFER_ACCOUNTS,
        'Las cuentas de origen y destino deben ser diferentes',
      );
    }

    const accountIds = isTransfer
      ? [body.accountId, body.transferAccountId]
      : [body.accountId];

    const accountsById = new Map(
      (await lockAccounts(client, scope.householdId, accountIds)).map(
        (account) => [account.id, account],
      ),
    );

    const sourceAccount = accountsById.get(body.accountId);

    if (!sourceAccount) {
      throw new AppError(
        404,
        ERROR_CODES.ACCOUNT_NOT_FOUND,
        'No se encontró la cuenta de origen en el hogar',
      );
    }

    if (!sourceAccount.is_active) {
      throw new AppError(
        400,
        ERROR_CODES.ACCOUNT_INACTIVE,
        'La cuenta de origen está inactiva',
      );
    }

    let destinationAccount: AccountValidationRow | undefined;

    if (isTransfer) {
      destinationAccount = accountsById.get(body.transferAccountId);

      if (!destinationAccount) {
        throw new AppError(
          404,
          ERROR_CODES.TRANSFER_ACCOUNT_NOT_FOUND,
          'No se encontró la cuenta de destino en el hogar',
        );
      }

      if (!destinationAccount.is_active) {
        throw new AppError(
          400,
          ERROR_CODES.TRANSFER_ACCOUNT_INACTIVE,
          'La cuenta de destino está inactiva',
        );
      }

      if (
        sourceAccount.account_type === 'credit_card' ||
        destinationAccount.account_type === 'credit_card'
      ) {
        throw new AppError(
          400,
          ERROR_CODES.USE_CREDIT_CARD_PAYMENT,
          'Los pagos y anticipos de tarjetas deben registrarse mediante la operación específica de pago de tarjeta',
        );
      }
    }

    let categoryId: string | null = null;

    if (!isTransfer) {
      categoryId = body.categoryId;

      const category = await getActiveCategories(
        client,
        scope.householdId,
        categoryId,
      );

      if (!category) {
        throw new AppError(
          404,
          ERROR_CODES.CATEGORY_NOT_FOUND,
          'No se encontró una categoría activa en el hogar',
        );
      }

      if (category.categoryType !== body.transactionType) {
        throw new AppError(
          400,
          ERROR_CODES.CATEGORY_TYPE_MISMATCH,
          'La categoría no corresponde al tipo de movimiento',
        );
      }
    }

    const status: TransactionStatus = body.status ?? 'posted';

    const sourceExchangeRate = resolveExchangeRate(
      body.exchangeRateToBase,
      sourceAccount.currency_code,
      household.base_currency_code,
    );

    let transferExchangeRate: number | null = null;
    let transferAmount: number | null = null;
    let transferAccountId: string | null = null;
    let transferCurrencyCode: CurrencyCode | null = null;

    if (isTransfer && destinationAccount) {
      transferAccountId = destinationAccount.id;
      transferAmount = body.transferAmount;
      transferCurrencyCode = destinationAccount.currency_code;

      const defaultDestinationRate =
        destinationAccount.currency_code === sourceAccount.currency_code
          ? sourceExchangeRate
          : undefined;

      transferExchangeRate = resolveExchangeRate(
        body.transferExchangeRateToBase ?? defaultDestinationRate,
        destinationAccount.currency_code,
        household.base_currency_code,
      );

      if (
        destinationAccount.currency_code === sourceAccount.currency_code &&
        transferExchangeRate !== sourceExchangeRate
      ) {
        throw new AppError(
          400,
          ERROR_CODES.TRANSFER_EXCHANGE_RATE_MISMATCH,
          'Las cuentas usan la misma moneda y deben tener la misma tasa de conversión',
        );
      }
    }

    const isCreditCardExpense =
      !isTransfer &&
      body.transactionType === 'expense' &&
      sourceAccount.account_type === 'credit_card';

    const installmentsCount = !isTransfer ? body.installmentsCount : undefined;

    if (installmentsCount !== undefined && !isCreditCardExpense) {
      throw new AppError(
        400,
        ERROR_CODES.INVALID_INSTALLMENTS,
        'Las cuotas solo se pueden configurar en gastos realizados con tarjeta de crédito',
      );
    }

    if (isCreditCardExpense && status !== 'posted') {
      throw new AppError(
        400,
        ERROR_CODES.CREDIT_CARD_EXPENSE_MUST_BE_POSTED,
        'Los gastos con tarjeta deben registrarse como movimientos confirmados',
      );
    }

    const effectiveInstallmentsCount = isCreditCardExpense
      ? (installmentsCount ?? 1)
      : null;

    const transaction = await insertTransaction(client, {
      householdId: scope.householdId,
      transactionType: body.transactionType,
      status,
      occurredAt: body.occurredAt ?? null,
      description: body.description ?? null,
      amount: body.amount,
      currencyCode: sourceAccount.currency_code,
      exchangeRateToBase: sourceExchangeRate,
      accountId: body.accountId,
      categoryId,
      transferAccountId,
      transferAmount,
      transferCurrencyCode,
      transferExchangeRateToBase: transferExchangeRate,
      notes: body.notes ?? null,
      userId: scope.userId,
    });

    if (!transaction) {
      throw new Error('Transaction insert did not return a row');
    }

    let creditCardPurchaseId: string | null = null;

    if (effectiveInstallmentsCount !== null) {
      creditCardPurchaseId =
        (await createCreditCardPurchase(
          client,
          transaction.id,
          effectiveInstallmentsCount,
          scope.userId,
        )) ?? null;

      if (!creditCardPurchaseId) {
        throw new Error(
          'Credit card purchase function did not return an identifier',
        );
      }
    }

    await writeAuditLog(client, scope, {
      action: 'create',
      entityName: 'transactions',
      entityId: transaction.id,
      newValues: {
        transactionType: transaction.transaction_type,
        status: transaction.status,
        occurredAt: transaction.occurred_at.toISOString(),
        description: transaction.description,
        amount: transaction.amount,
        currencyCode: transaction.currency_code,
        exchangeRateToBase: transaction.exchange_rate_to_base,
        amountBase: transaction.amount_base,
        accountId: transaction.account_id,
        categoryId: transaction.category_id,
        transferAccountId: transaction.transfer_account_id,
        transferAmount: transaction.transfer_amount,
        transferCurrencyCode: transaction.transfer_currency_code,
        transferExchangeRateToBase: transaction.transfer_exchange_rate_to_base,
        transferAmountBase: transaction.transfer_amount_base,
        creditCardPurchaseId,
        installmentsCount: effectiveInstallmentsCount,
      },
    });

    return {
      transaction,
      creditCardPurchaseId,
    };
  });
}
