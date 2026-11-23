import type { CATEGORY_TYPES } from './category.constants.js';

export type CategoryType = (typeof CATEGORY_TYPES)[number];

export interface ListCategoriesQuery {
  categoryType?: CategoryType;
  includeInactive?: boolean;
}

export interface CategoryParams {
  categoryId: string;
}

export interface CategoryRow {
  id: string;
  name: string;
  categoryType: CategoryType;

  parentId: string | null;
  parentName: string | null;

  isSystem: boolean;
  isActive: boolean;
  sortOrder: number;

  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCategoryBody {
  name: string;
  categoryType: CategoryType;
  parentId?: string | null;
  sortOrder?: number;
}

export interface UpdateCategoryBody {
  name?: string;
  parentId?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

export interface CategoryParentRow {
  id: string;
  category_type: CategoryType;
  is_active: boolean;
}

export interface CategoryForUpdateRow extends CategoryRow {
  householdId: string | null;
}

export interface CategoryExistsRow {
  exists: boolean;
}
