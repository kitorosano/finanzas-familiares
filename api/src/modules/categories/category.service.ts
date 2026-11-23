import { withTransaction } from '../../db/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { ERROR_CODES } from '../../errors/error-codes.js';

import { writeAuditLog } from '../audit/audit.db.js';
import type { HouseholdScope } from '../authorization/authorization.types.js';

import {
  createCategory as createCategoryInDb,
  getCategoryById as getCategoryByIdFromDb,
  getCategoryForUpdate,
  getCategoryParentForCreate,
  hasActiveCategoryDescendants,
  isParentInCategorySubtree,
  listCategories as listCategoriesFromDb,
  lockHouseholdCategories,
  updateCategory as updateCategoryInDb,
} from './category.db.js';

import type {
  CategoryRow,
  CreateCategoryBody,
  ListCategoriesQuery,
  UpdateCategoryBody,
} from './category.types.js';
import {
  getCategoryAuditValues,
  isCategoryNameConflict,
  validateCategoryName,
} from './category.utils.js';

export async function listCategories(
  scope: HouseholdScope,
  filters: ListCategoriesQuery,
): Promise<CategoryRow[]> {
  return listCategoriesFromDb(scope.householdId, filters);
}

export async function getCategoryById(
  scope: HouseholdScope,
  categoryId: string,
): Promise<CategoryRow> {
  const category = await getCategoryByIdFromDb(scope.householdId, categoryId);

  if (!category) {
    throw new AppError(
      404,
      ERROR_CODES.CATEGORY_NOT_FOUND,
      'No se encontró la categoría en el hogar',
    );
  }

  return category;
}

export async function createCategory(
  scope: HouseholdScope,
  body: CreateCategoryBody,
): Promise<CategoryRow> {
  const name = validateCategoryName(body.name);

  try {
    return await withTransaction(async (client) => {
      const parentId = body.parentId ?? null;

      if (parentId !== null) {
        const parent = await getCategoryParentForCreate(
          client,
          scope.householdId,
          parentId,
        );

        if (!parent) {
          throw new AppError(
            404,
            ERROR_CODES.CATEGORY_PARENT_NOT_FOUND,
            'No se encontró la categoría padre en el hogar',
          );
        }

        if (!parent.is_active) {
          throw new AppError(
            400,
            ERROR_CODES.CATEGORY_PARENT_INACTIVE,
            'No se puede utilizar una categoría padre inactiva',
          );
        }

        if (parent.category_type !== body.categoryType) {
          throw new AppError(
            400,
            ERROR_CODES.CATEGORY_PARENT_TYPE_MISMATCH,
            'La categoría padre debe ser del mismo tipo',
          );
        }
      }

      const category = await createCategoryInDb(client, scope.householdId, {
        name,
        categoryType: body.categoryType,
        parentId,
        sortOrder: body.sortOrder ?? 0,
      });

      if (!category) {
        throw new Error('Category insert did not return a row');
      }

      await writeAuditLog(client, scope, {
        action: 'create',
        entityName: 'categories',
        entityId: category.id,
        newValues: getCategoryAuditValues(category),
      });

      return category;
    });
  } catch (error) {
    if (isCategoryNameConflict(error)) {
      throw new AppError(
        409,
        ERROR_CODES.CATEGORY_ALREADY_EXISTS,
        'Ya existe una categoría con ese nombre y tipo en el hogar',
      );
    }

    throw error;
  }
}

export async function updateCategory(
  scope: HouseholdScope,
  categoryId: string,
  body: UpdateCategoryBody,
): Promise<CategoryRow> {
  const name =
    body.name !== undefined ? validateCategoryName(body.name) : undefined;

  try {
    return await withTransaction(async (client) => {
      // Serialize hierarchy modifications within this household.
      await lockHouseholdCategories(client, scope.householdId);

      const category = await getCategoryForUpdate(
        client,
        scope.householdId,
        categoryId,
      );

      if (!category) {
        throw new AppError(
          404,
          ERROR_CODES.CATEGORY_NOT_FOUND,
          'No se encontró la categoría en el hogar',
        );
      }

      // Global categories and system categories are read-only.
      if (category.householdId !== scope.householdId || category.isSystem) {
        throw new AppError(
          403,
          ERROR_CODES.CATEGORY_SYSTEM_READ_ONLY,
          'No se pueden modificar categorías del sistema',
        );
      }

      // Validate the selected or existing parent when changing it
      // or reactivating the category.
      const parentIdToValidate =
        body.parentId !== undefined
          ? body.parentId
          : body.isActive === true
            ? category.parentId
            : null;

      if (parentIdToValidate !== null) {
        const parent = await getCategoryParentForCreate(
          client,
          scope.householdId,
          parentIdToValidate,
        );

        if (!parent) {
          throw new AppError(
            404,
            ERROR_CODES.CATEGORY_PARENT_NOT_FOUND,
            'No se encontró la categoría padre en el hogar',
          );
        }

        if (!parent.is_active) {
          throw new AppError(
            400,
            ERROR_CODES.CATEGORY_PARENT_INACTIVE,
            'No se puede utilizar una categoría padre inactiva',
          );
        }

        if (parent.category_type !== category.categoryType) {
          throw new AppError(
            400,
            ERROR_CODES.CATEGORY_PARENT_TYPE_MISMATCH,
            'La categoría padre debe ser del mismo tipo',
          );
        }

        // Only check for cycles when an explicit parent change
        // is requested.
        if (
          body.parentId !== undefined &&
          (await isParentInCategorySubtree(
            client,
            scope.householdId,
            categoryId,
            parentIdToValidate,
          ))
        ) {
          throw new AppError(
            400,
            ERROR_CODES.CATEGORY_PARENT_CYCLE,
            'La categoría no puede depender de sí misma ni de una subcategoría',
          );
        }
      }

      // An active descendant must be deactivated or moved first.
      if (
        body.isActive === false &&
        (await hasActiveCategoryDescendants(
          client,
          scope.householdId,
          categoryId,
        ))
      ) {
        throw new AppError(
          409,
          ERROR_CODES.CATEGORY_HAS_ACTIVE_DESCENDANTS,
          'No se puede desactivar una categoría que tiene subcategorías activas',
        );
      }

      const updatedCategory = await updateCategoryInDb(
        client,
        scope.householdId,
        categoryId,
        {
          ...body,
          ...(name !== undefined ? { name } : {}),
        },
      );

      if (!updatedCategory) {
        throw new Error('Category update did not return a row');
      }

      await writeAuditLog(client, scope, {
        action: 'update',
        entityName: 'categories',
        entityId: categoryId,
        oldValues: getCategoryAuditValues(category),
        newValues: getCategoryAuditValues(updatedCategory),
      });

      return updatedCategory;
    });
  } catch (error) {
    if (isCategoryNameConflict(error)) {
      throw new AppError(
        409,
        ERROR_CODES.CATEGORY_ALREADY_EXISTS,
        'Ya existe una categoría con ese nombre y tipo en el hogar',
      );
    }

    throw error;
  }
}
