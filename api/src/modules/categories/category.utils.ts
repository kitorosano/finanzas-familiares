import { AppError } from '../../errors/app-error.js';
import { ERROR_CODES } from '../../errors/error-codes.js';
import { CategoryRow } from './category.types.js';

export function isCategoryNameConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const databaseError = error as {
    code?: string;
    constraint?: string;
  };

  return (
    databaseError.code === '23505' &&
    databaseError.constraint === 'categories_household_unique'
  );
}

export function validateCategoryName(name: string): string {
  const normalizedName = name.trim();

  if (!normalizedName) {
    throw new AppError(
      400,
      ERROR_CODES.INVALID_CATEGORY_NAME,
      'El nombre de la categoría no puede estar vacío',
    );
  }

  return normalizedName;
}

export function getCategoryAuditValues(category: CategoryRow) {
  return {
    name: category.name,
    categoryType: category.categoryType,
    parentId: category.parentId,
    isSystem: category.isSystem,
    isActive: category.isActive,
    sortOrder: category.sortOrder,
  };
}
