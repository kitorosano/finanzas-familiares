import { AppError } from '../../errors/app-error.js';
import { ERROR_CODES } from '../../errors/error-codes.js';

import type { HouseholdScope } from '../authorization/authorization.types.js';

import {
  getAccountById as getAccountByIdFromDb,
  listAccounts as listAccountsFromDb,
} from './account.db.js';
import type { AccountRow, ListAccountsQuery } from './account.types.js';

export async function listAccounts(
  scope: HouseholdScope,
  filters: ListAccountsQuery,
): Promise<AccountRow[]> {
  return listAccountsFromDb(scope.householdId, filters);
}

export async function getAccountById(
  scope: HouseholdScope,
  accountId: string,
): Promise<AccountRow> {
  const account = await getAccountByIdFromDb(scope.householdId, accountId);

  if (!account) {
    throw new AppError(
      404,
      ERROR_CODES.ACCOUNT_NOT_FOUND,
      'No se encontró la cuenta en el hogar',
    );
  }

  return account;
}
