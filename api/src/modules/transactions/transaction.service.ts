import { withTransaction } from '../../db/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { ERROR_CODES } from '../../errors/error-codes.js';
import type { CurrencyCode } from '../../types/money.js';
import { isPositiveFiniteNumber } from '../../utils/validation.js';

import { lockAccounts } from '../accounts/account.db.js';
import type { AccountValidationRow } from '../accounts/account.types.js';
import { setAuditActor } from '../audit/audit-context.js';
import { writeAuditLog } from '../audit/audit.db.js';
import { getHouseholdScope } from '../authorization/household-context.js';
import { getActiveCategories } from '../categories/category.db.js';

import type { FastifyRequest } from 'fastify';
import {
  createCreditCardPurchase,
  getHouseholdBaseCurrency,
  getTransactionById as getTransactionByIdFromDb,
  getTransactionByIdWithClient,
  getTransactionForUpdate,
  insertTransaction,
  listTransactions as listTransactionsFromDb,
  updateTransaction as updateTransactionInDb,
  voidTransaction as voidTransactionInDb,
} from './transaction.db.js';
import type {
  CreateTransactionBody,
  CreateTransactionResult,
  ListTransactionsQuery,
  TransactionQueryRow,
  TransactionStatus,
  TransactionsListResult,
  UpdateTransactionBody,
  VoidTransactionBody,
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

export async function listTransactions(
  request: FastifyRequest,
  filters: ListTransactionsQuery,
): Promise<TransactionsListResult> {
  const scope = getHouseholdScope(request);

  if (
    filters.occurredFrom !== undefined &&
    filters.occurredTo !== undefined &&
    filters.occurredFrom > filters.occurredTo
  ) {
    throw new AppError(
      400,
      ERROR_CODES.INVALID_TRANSACTION_DATE_RANGE,
      'La fecha inicial no puede ser posterior a la fecha final',
    );
  }

  return listTransactionsFromDb(scope.householdId, filters);
}

export async function getTransactionById(
  request: FastifyRequest,
  transactionId: string,
): Promise<TransactionQueryRow> {
  const scope = getHouseholdScope(request);

  const transaction = await getTransactionByIdFromDb(
    scope.householdId,
    transactionId,
  );

  if (!transaction) {
    throw new AppError(
      404,
      ERROR_CODES.TRANSACTION_NOT_FOUND,
      'No se encontró el movimiento en el hogar',
    );
  }

  return transaction;
}

export async function updateTransaction(
  request: FastifyRequest,
  transactionId: string,
  body: UpdateTransactionBody,
): Promise<TransactionQueryRow> {
  const scope = getHouseholdScope(request);

  return withTransaction(async (client) => {
    await setAuditActor(client, scope.userId);

    const current = await getTransactionForUpdate(
      client,
      scope.householdId,
      transactionId,
    );

    if (!current) {
      throw new AppError(
        404,
        ERROR_CODES.TRANSACTION_NOT_FOUND,
        'No se encontró el movimiento en el hogar',
      );
    }

    if (current.status === 'void') {
      throw new AppError(
        409,
        ERROR_CODES.TRANSACTION_ALREADY_VOID,
        'No se puede modificar un movimiento anulado',
      );
    }

    const isTransfer = current.transaction_type === 'transfer';

    const hasTransferFields =
      body.transferAccountId !== undefined ||
      body.transferAmount !== undefined ||
      body.transferExchangeRateToBase !== undefined;

    if (
      (isTransfer && body.categoryId !== undefined) ||
      (!isTransfer && hasTransferFields)
    ) {
      throw new AppError(
        400,
        ERROR_CODES.INVALID_TRANSACTION_UPDATE_FIELDS,
        'Los campos enviados no corresponden al tipo de movimiento',
      );
    }

    // Las compras y los pagos de tarjetas tienen dependencias
    // financieras que no deben modificarse mediante un PATCH genérico.
    if (
      current.has_credit_card_purchase ||
      current.has_card_payment_allocations ||
      current.account_type === 'credit_card' ||
      current.transfer_account_type === 'credit_card'
    ) {
      throw new AppError(
        409,
        ERROR_CODES.TRANSACTION_REQUIRES_SPECIALIZED_OPERATION,
        'Este movimiento está relacionado con una tarjeta de crédito y requiere una operación especializada',
      );
    }

    const household = await getHouseholdBaseCurrency(client, scope.householdId);

    if (!household) {
      throw new AppError(
        404,
        ERROR_CODES.HOUSEHOLD_NOT_FOUND,
        'No se encontró el hogar de la sesión',
      );
    }

    const accountId = body.accountId ?? current.account_id;

    const transferAccountId = isTransfer
      ? (body.transferAccountId ?? current.transfer_account_id)
      : null;

    if (isTransfer && (!transferAccountId || accountId === transferAccountId)) {
      throw new AppError(
        400,
        ERROR_CODES.INVALID_TRANSFER_ACCOUNTS,
        'Las cuentas de origen y destino deben ser diferentes',
      );
    }

    const accountIds = [
      ...new Set(
        isTransfer ? [accountId, transferAccountId as string] : [accountId],
      ),
    ];

    const accountsById = new Map(
      (await lockAccounts(client, scope.householdId, accountIds)).map(
        (account) => [account.id, account],
      ),
    );

    const sourceAccount = accountsById.get(accountId);

    if (!sourceAccount) {
      throw new AppError(
        404,
        ERROR_CODES.ACCOUNT_NOT_FOUND,
        'No se encontró la cuenta de origen en el hogar',
      );
    }

    if (
      body.accountId !== undefined &&
      body.accountId !== current.account_id &&
      !sourceAccount.is_active
    ) {
      throw new AppError(
        400,
        ERROR_CODES.ACCOUNT_INACTIVE,
        'La nueva cuenta de origen está inactiva',
      );
    }

    if (sourceAccount.account_type === 'credit_card') {
      throw new AppError(
        409,
        ERROR_CODES.TRANSACTION_REQUIRES_SPECIALIZED_OPERATION,
        'No se puede mover un movimiento ordinario a una tarjeta de crédito mediante esta operación',
      );
    }

    let destinationAccount: AccountValidationRow | undefined;

    if (isTransfer && transferAccountId) {
      destinationAccount = accountsById.get(transferAccountId);

      if (!destinationAccount) {
        throw new AppError(
          404,
          ERROR_CODES.TRANSFER_ACCOUNT_NOT_FOUND,
          'No se encontró la cuenta de destino en el hogar',
        );
      }

      if (
        body.transferAccountId !== undefined &&
        body.transferAccountId !== current.transfer_account_id &&
        !destinationAccount.is_active
      ) {
        throw new AppError(
          400,
          ERROR_CODES.TRANSFER_ACCOUNT_INACTIVE,
          'La nueva cuenta de destino está inactiva',
        );
      }

      if (destinationAccount.account_type === 'credit_card') {
        throw new AppError(
          409,
          ERROR_CODES.TRANSACTION_REQUIRES_SPECIALIZED_OPERATION,
          'No se puede transferir a una tarjeta de crédito mediante esta operación',
        );
      }
    }

    let categoryId: string | null = isTransfer ? null : current.category_id;

    if (!isTransfer && body.categoryId !== undefined) {
      const category = await getActiveCategories(
        client,
        scope.householdId,
        body.categoryId,
      );

      if (!category) {
        throw new AppError(
          404,
          ERROR_CODES.CATEGORY_NOT_FOUND,
          'No se encontró una categoría activa en el hogar',
        );
      }

      if (category.categoryType !== current.transaction_type) {
        throw new AppError(
          400,
          ERROR_CODES.CATEGORY_TYPE_MISMATCH,
          'La categoría no corresponde al tipo de movimiento',
        );
      }

      categoryId = body.categoryId;
    }

    const status: TransactionStatus =
      body.status ?? (current.status as TransactionStatus);

    const amount = body.amount ?? Number(current.amount);

    const occurredAt = body.occurredAt ?? current.occurred_at.toISOString();

    const description =
      body.description !== undefined ? body.description : current.description;

    const notes = body.notes !== undefined ? body.notes : current.notes;

    // Preservar la tasa histórica si la moneda de origen no cambia.
    // Si cambia de moneda, se exige una tasa nueva (salvo moneda base).
    const sourceRateCandidate =
      body.exchangeRateToBase ??
      (sourceAccount.currency_code === current.currency_code
        ? Number(current.exchange_rate_to_base)
        : undefined);

    const sourceExchangeRate = resolveExchangeRate(
      sourceRateCandidate,
      sourceAccount.currency_code,
      household.base_currency_code,
    );

    let transferAmount: number | null = null;
    let transferCurrencyCode: CurrencyCode | null = null;
    let transferExchangeRate: number | null = null;

    if (isTransfer && destinationAccount) {
      transferAmount = body.transferAmount ?? Number(current.transfer_amount);

      transferCurrencyCode = destinationAccount.currency_code;

      const transferRateCandidate =
        body.transferExchangeRateToBase ??
        (destinationAccount.currency_code === sourceAccount.currency_code
          ? sourceExchangeRate
          : destinationAccount.currency_code === current.transfer_currency_code
            ? Number(current.transfer_exchange_rate_to_base)
            : undefined);

      transferExchangeRate = resolveExchangeRate(
        transferRateCandidate,
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

    const oldValues = {
      transactionType: current.transaction_type,
      status: current.status,
      occurredAt: current.occurred_at.toISOString(),
      description: current.description,
      amount: current.amount,
      currencyCode: current.currency_code,
      exchangeRateToBase: current.exchange_rate_to_base,
      amountBase: current.amount_base,
      accountId: current.account_id,
      categoryId: current.category_id,
      transferAccountId: current.transfer_account_id,
      transferAmount: current.transfer_amount,
      transferCurrencyCode: current.transfer_currency_code,
      transferExchangeRateToBase: current.transfer_exchange_rate_to_base,
      transferAmountBase: current.transfer_amount_base,
      notes: current.notes,
    };

    const updated = await updateTransactionInDb(
      client,
      scope.householdId,
      transactionId,
      {
        occurredAt,
        description,
        amount,
        currencyCode: sourceAccount.currency_code,
        exchangeRateToBase: sourceExchangeRate,
        accountId,
        categoryId,
        status,
        transferAccountId,
        transferAmount,
        transferCurrencyCode,
        transferExchangeRateToBase: transferExchangeRate,
        notes,
        userId: scope.userId,
      },
    );

    if (!updated) {
      throw new Error('Transaction update did not return a row');
    }

    const transaction = await getTransactionByIdWithClient(
      client,
      scope.householdId,
      transactionId,
    );

    if (!transaction) {
      throw new Error('Updated transaction could not be retrieved');
    }

    await writeAuditLog(client, scope, {
      action: 'update',
      entityName: 'transactions',
      entityId: transactionId,
      oldValues,
      newValues: {
        transactionType: transaction.transactionType,
        status: transaction.status,
        occurredAt: transaction.occurredAt.toISOString(),
        description: transaction.description,
        amount: transaction.amount,
        currencyCode: transaction.currencyCode,
        exchangeRateToBase: transaction.exchangeRateToBase,
        amountBase: transaction.amountBase,
        accountId: transaction.accountId,
        categoryId: transaction.categoryId,
        transferAccountId: transaction.transferAccountId,
        transferAmount: transaction.transferAmount,
        transferCurrencyCode: transaction.transferCurrencyCode,
        transferExchangeRateToBase: transaction.transferExchangeRateToBase,
        transferAmountBase: transaction.transferAmountBase,
        notes: transaction.notes,
      },
    });

    return transaction;
  });
}

export async function voidTransaction(
  request: FastifyRequest,
  transactionId: string,
  body: VoidTransactionBody,
): Promise<TransactionQueryRow> {
  const scope = getHouseholdScope(request);
  const reason = body.reason.trim();

  if (reason.length === 0) {
    throw new AppError(
      400,
      ERROR_CODES.INVALID_TRANSACTION_VOID_REASON,
      'El motivo de anulación no puede estar vacío',
    );
  }

  return withTransaction(async (client) => {
    await setAuditActor(client, scope.userId);

    const current = await getTransactionForUpdate(
      client,
      scope.householdId,
      transactionId,
    );

    if (!current) {
      throw new AppError(
        404,
        ERROR_CODES.TRANSACTION_NOT_FOUND,
        'No se encontró el movimiento en el hogar',
      );
    }

    if (current.status === 'void') {
      throw new AppError(
        409,
        ERROR_CODES.TRANSACTION_ALREADY_VOID,
        'El movimiento ya se encuentra anulado',
      );
    }

    const requiresSpecializedOperation =
      current.has_credit_card_purchase ||
      current.has_card_payment_allocations ||
      current.has_savings_goal_contribution ||
      current.account_type === 'credit_card' ||
      current.transfer_account_type === 'credit_card';

    if (requiresSpecializedOperation) {
      throw new AppError(
        409,
        ERROR_CODES.TRANSACTION_REQUIRES_SPECIALIZED_OPERATION,
        'Este movimiento está relacionado con una operación financiera especializada y no puede anularse mediante esta operación',
      );
    }

    const oldValues = {
      transactionType: current.transaction_type,
      status: current.status,
      occurredAt: current.occurred_at.toISOString(),
      description: current.description,
      amount: current.amount,
      currencyCode: current.currency_code,
      exchangeRateToBase: current.exchange_rate_to_base,
      amountBase: current.amount_base,
      accountId: current.account_id,
      categoryId: current.category_id,
      transferAccountId: current.transfer_account_id,
      transferAmount: current.transfer_amount,
      transferCurrencyCode: current.transfer_currency_code,
      transferExchangeRateToBase: current.transfer_exchange_rate_to_base,
      transferAmountBase: current.transfer_amount_base,
      notes: current.notes,
      voidedAt: current.voided_at?.toISOString() ?? null,
    };

    const voidResult = await voidTransactionInDb(
      client,
      scope.householdId,
      transactionId,
      scope.userId,
    );

    if (!voidResult) {
      throw new Error('Transaction void did not return a row');
    }

    const transaction = await getTransactionByIdWithClient(
      client,
      scope.householdId,
      transactionId,
    );

    if (!transaction) {
      throw new Error('Voided transaction could not be retrieved');
    }

    await writeAuditLog(client, scope, {
      action: 'void',
      entityName: 'transactions',
      entityId: transactionId,
      oldValues,
      newValues: {
        transactionType: transaction.transactionType,
        status: transaction.status,
        occurredAt: transaction.occurredAt.toISOString(),
        description: transaction.description,
        amount: transaction.amount,
        currencyCode: transaction.currencyCode,
        exchangeRateToBase: transaction.exchangeRateToBase,
        amountBase: transaction.amountBase,
        accountId: transaction.accountId,
        categoryId: transaction.categoryId,
        transferAccountId: transaction.transferAccountId,
        transferAmount: transaction.transferAmount,
        transferCurrencyCode: transaction.transferCurrencyCode,
        transferExchangeRateToBase: transaction.transferExchangeRateToBase,
        transferAmountBase: transaction.transferAmountBase,
        notes: transaction.notes,
        voidedAt: transaction.voidedAt?.toISOString() ?? null,
        reason,
      },
    });

    return transaction;
  });
}
