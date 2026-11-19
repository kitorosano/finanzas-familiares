import { db } from '../../db.js';
import { AppError } from '../../errors/app-error.js';

import type { HouseholdScope } from '../authorization/household-context.js';

import type { AccountRow, ListAccountsQuery } from './account.types.js';

const ACCOUNT_SELECT = `
  SELECT
    a.id::text AS id,
    a.name,
    a.account_type AS "accountType",
    a.currency_code AS "currencyCode",
    a.institution,

    a.holder_user_id::text AS "holderUserId",
    u.display_name AS "holderName",

    a.opening_balance::text AS "openingBalance",
    a.opening_balance_date::text AS "openingBalanceDate",

    a.credit_limit::text AS "creditLimit",

    a.include_in_net_worth AS "includeInNetWorth",
    a.is_active AS "isActive",
    ab.is_liability AS "isLiability",

    ab.balance::text AS balance,
    ab.base_currency_code AS "baseCurrencyCode",
    ab.exchange_rate_to_base::text AS "exchangeRateToBase",
    ab.balance_base::text AS "balanceBase",
    ab.conversion_status AS "conversionStatus",

    a.statement_closing_day AS "statementClosingDay",
    a.payment_due_day AS "paymentDueDay",
    a.payment_due_month_offset AS "paymentDueMonthOffset",

    a.notes,
    a.created_at AS "createdAt",
    a.updated_at AS "updatedAt"

  FROM accounts a

  JOIN account_balances ab
    ON ab.account_id = a.id
   AND ab.household_id = a.household_id

  LEFT JOIN users u
    ON u.id = a.holder_user_id

  WHERE a.household_id = $1
`;

export async function listAccounts(
  scope: HouseholdScope,
  filters: ListAccountsQuery,
): Promise<AccountRow[]> {
  const result = await db.query<AccountRow>(
    `
      ${ACCOUNT_SELECT}
        AND ($2::varchar IS NULL OR a.account_type = $2)
        AND ($3::char(3) IS NULL OR a.currency_code = $3)
        AND ($4::boolean OR a.is_active = TRUE)

      ORDER BY
        a.account_type,
        a.currency_code,
        a.name,
        a.id
    `,
    [
      scope.householdId,
      filters.accountType ?? null,
      filters.currencyCode ?? null,
      filters.includeInactive ?? false,
    ],
  );

  return result.rows;
}

export async function getAccountById(
  scope: HouseholdScope,
  accountId: string,
): Promise<AccountRow> {
  const result = await db.query<AccountRow>(
    `
      ${ACCOUNT_SELECT}
        AND a.id = $2
      LIMIT 1
    `,
    [scope.householdId, accountId],
  );

  const account = result.rows[0];

  if (!account) {
    throw new AppError(
      404,
      'ACCOUNT_NOT_FOUND',
      'No se encontró la cuenta en el hogar',
    );
  }

  return account;
}
