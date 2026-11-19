import { withTransaction } from '../../db/transaction.js';
import { AppError } from '../../errors/app-error.js';

import { writeAuditLog } from '../audit/audit.service.js';
import { getHouseholdScope } from '../authorization/household-context.js';
import { setAuditActor } from '../audit/audit-context.js';

import type {
  CreateTransactionBody,
  TransactionRow,
  TransactionStatus,
} from './transaction.types.js';

import type { FastifyRequest } from 'fastify';

interface AccountRow {
  id: string;
  currency_code: string;
  account_type: string;
  is_active: boolean;
}

interface HouseholdRow {
  base_currency_code: string;
}

interface CategoryRow {
  id: string;
  category_type: 'income' | 'expense';
}

interface CreatedPurchaseRow {
  purchase_id: string;
}

export interface CreateTransactionResult {
  transaction: TransactionRow;
  creditCardPurchaseId: string | null;
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

export async function createTransaction(
  request: FastifyRequest,
  body: CreateTransactionBody,
): Promise<CreateTransactionResult> {
  const scope = getHouseholdScope(request);

  return withTransaction(async (client) => {
    await setAuditActor(client, scope.userId);
    
    const householdResult = await client.query<HouseholdRow>(
      `
        SELECT base_currency_code
        FROM households
        WHERE id = $1
        FOR SHARE
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

    const isTransfer = body.transactionType === 'transfer';

    if (isTransfer && body.accountId === body.transferAccountId) {
      throw new AppError(
        400,
        'INVALID_TRANSFER_ACCOUNTS',
        'Las cuentas de origen y destino deben ser diferentes',
      );
    }

    const accountIds = isTransfer
      ? [body.accountId, body.transferAccountId]
      : [body.accountId];

    const accountsResult = await client.query<AccountRow>(
      `
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
      [scope.householdId, accountIds],
    );

    const accountsById = new Map(
      accountsResult.rows.map((account) => [account.id, account]),
    );

    const sourceAccount = accountsById.get(body.accountId);

    if (!sourceAccount) {
      throw new AppError(
        404,
        'ACCOUNT_NOT_FOUND',
        'No se encontró la cuenta de origen en el hogar',
      );
    }

    if (!sourceAccount.is_active) {
      throw new AppError(
        400,
        'ACCOUNT_INACTIVE',
        'La cuenta de origen está inactiva',
      );
    }

    let destinationAccount: AccountRow | undefined;

    if (isTransfer) {
      destinationAccount = accountsById.get(body.transferAccountId);

      if (!destinationAccount) {
        throw new AppError(
          404,
          'TRANSFER_ACCOUNT_NOT_FOUND',
          'No se encontró la cuenta de destino en el hogar',
        );
      }

      if (!destinationAccount.is_active) {
        throw new AppError(
          400,
          'TRANSFER_ACCOUNT_INACTIVE',
          'La cuenta de destino está inactiva',
        );
      }

      if (
        sourceAccount.account_type === 'credit_card' ||
        destinationAccount.account_type === 'credit_card'
      ) {
        throw new AppError(
          400,
          'USE_CREDIT_CARD_PAYMENT',
          'Los pagos y anticipos de tarjetas deben registrarse mediante la operación específica de pago de tarjeta',
        );
      }
    }

    let categoryId: string | null = null;

    if (!isTransfer) {
      categoryId = body.categoryId;

      const categoryResult = await client.query<CategoryRow>(
        `
          SELECT
            id::text AS id,
            category_type
          FROM categories
          WHERE id = $1
            AND (household_id = $2 OR household_id IS NULL)
            AND is_active = TRUE
        `,
        [categoryId, scope.householdId],
      );

      const category = categoryResult.rows[0];

      if (!category) {
        throw new AppError(
          404,
          'CATEGORY_NOT_FOUND',
          'No se encontró una categoría activa en el hogar',
        );
      }

      if (category.category_type !== body.transactionType) {
        throw new AppError(
          400,
          'CATEGORY_TYPE_MISMATCH',
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
    let transferCurrencyCode: string | null = null;

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
          'TRANSFER_EXCHANGE_RATE_MISMATCH',
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
        'INVALID_INSTALLMENTS',
        'Las cuotas solo se pueden configurar en gastos realizados con tarjeta de crédito',
      );
    }

    if (isCreditCardExpense && status !== 'posted') {
      throw new AppError(
        400,
        'CREDIT_CARD_EXPENSE_MUST_BE_POSTED',
        'Los gastos con tarjeta deben registrarse como movimientos confirmados',
      );
    }

    const effectiveInstallmentsCount = isCreditCardExpense
      ? (installmentsCount ?? 1)
      : null;

    const insertResult = await client.query<TransactionRow>(
      `
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
      [
        scope.householdId,
        body.transactionType,
        status,
        body.occurredAt ?? null,
        body.description ?? null,
        body.amount,
        sourceAccount.currency_code,
        sourceExchangeRate,
        body.accountId,
        categoryId,
        transferAccountId,
        transferAmount,
        transferCurrencyCode,
        transferExchangeRate,
        body.notes ?? null,
        scope.userId,
      ],
    );

    const transaction = insertResult.rows[0];

    if (!transaction) {
      throw new Error('Transaction insert did not return a row');
    }

    let creditCardPurchaseId: string | null = null;

    if (effectiveInstallmentsCount !== null) {
      const purchaseResult = await client.query<CreatedPurchaseRow>(
        `
          SELECT public.create_credit_card_purchase_auto(
            $1::uuid,
            $2::smallint,
            $3::uuid
          ) AS purchase_id
        `,
        [transaction.id, effectiveInstallmentsCount, scope.userId],
      );

      creditCardPurchaseId = purchaseResult.rows[0]?.purchase_id ?? null;

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
