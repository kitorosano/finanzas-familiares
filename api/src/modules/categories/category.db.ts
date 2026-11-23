import type { PoolClient } from 'pg';

import { db } from '../../db/pool.js';

import type {
  CategoryExistsRow,
  CategoryForUpdateRow,
  CategoryParentRow,
  CategoryRow,
  CreateCategoryBody,
  ListCategoriesQuery,
  UpdateCategoryBody,
} from './category.types.js';

const CATEGORY_SELECT = `
  SELECT
    c.id::text AS id,
    c.name,
    c.category_type AS "categoryType",

    p.id::text AS "parentId",
    p.name AS "parentName",

    c.is_system AS "isSystem",
    c.is_active AS "isActive",
    c.sort_order AS "sortOrder",

    c.created_at AS "createdAt",
    c.updated_at AS "updatedAt"

  FROM categories c

  LEFT JOIN categories p
    ON p.id = c.parent_id
   AND (
     p.household_id IS NULL
     OR (
       c.household_id IS NOT NULL
       AND p.household_id = $1
     )
   )

  WHERE (
    c.household_id = $1
    OR c.household_id IS NULL
  )
`;

const CATEGORY_QUERIES = {
  list: `
    ${CATEGORY_SELECT}
      AND ($2::varchar IS NULL OR c.category_type = $2)
      AND ($3::boolean OR c.is_active = TRUE)

    ORDER BY
      c.category_type,
      c.parent_id NULLS FIRST,
      c.sort_order,
      c.name,
      c.id
  `,

  getById: `
    ${CATEGORY_SELECT}
      AND c.id = $2

    LIMIT 1
  `,

  getActiveCategories: `
    ${CATEGORY_SELECT}
      AND c.id = $2
      AND c.is_active = TRUE

    LIMIT 1
  `,

  getParentForCreate: `
    SELECT
      id::text AS id,
      category_type,
      is_active
    FROM categories
    WHERE id = $1
      AND (
        household_id = $2
        OR household_id IS NULL
      )
    FOR SHARE
  `,

  create: `
    WITH inserted AS (
      INSERT INTO categories (
        household_id,
        parent_id,
        name,
        category_type,
        is_system,
        is_active,
        sort_order
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        FALSE,
        TRUE,
        $5
      )
      RETURNING
        id,
        name,
        category_type,
        parent_id,
        is_system,
        is_active,
        sort_order,
        created_at,
        updated_at
    )

    SELECT
      i.id::text AS id,
      i.name,
      i.category_type AS "categoryType",

      i.parent_id::text AS "parentId",
      p.name AS "parentName",

      i.is_system AS "isSystem",
      i.is_active AS "isActive",
      i.sort_order AS "sortOrder",

      i.created_at AS "createdAt",
      i.updated_at AS "updatedAt"

    FROM inserted i

    LEFT JOIN categories p
      ON p.id = i.parent_id
  `,

  lockHouseholdCategories: `
    SELECT id
    FROM categories
    WHERE household_id = $1
    ORDER BY id
    FOR UPDATE
  `,

  getForUpdate: `
    SELECT
      c.id::text AS id,
      c.household_id::text AS "householdId",
      c.name,
      c.category_type AS "categoryType",

      c.parent_id::text AS "parentId",
      p.name AS "parentName",

      c.is_system AS "isSystem",
      c.is_active AS "isActive",
      c.sort_order AS "sortOrder",

      c.created_at AS "createdAt",
      c.updated_at AS "updatedAt"

    FROM categories c

    LEFT JOIN categories p
      ON p.id = c.parent_id
      AND (
        p.household_id IS NULL
        OR p.household_id = $1
      )

    WHERE c.id = $2
      AND (
        c.household_id = $1
        OR c.household_id IS NULL
      )

    FOR UPDATE OF c
  `,

  isParentInSubtree: `
    WITH RECURSIVE category_subtree(id) AS (
      SELECT id
      FROM categories
      WHERE id = $2
        AND household_id = $1

      UNION

      SELECT child.id
      FROM categories child
      JOIN category_subtree parent
        ON child.parent_id = parent.id
      WHERE child.household_id = $1
    )

    SELECT EXISTS (
      SELECT 1
      FROM category_subtree
      WHERE id = $3
    ) AS exists
  `,

  hasActiveDescendants: `
    WITH RECURSIVE category_subtree(id) AS (
      SELECT id
      FROM categories
      WHERE id = $2
        AND household_id = $1

      UNION

      SELECT child.id
      FROM categories child
      JOIN category_subtree parent
        ON child.parent_id = parent.id
      WHERE child.household_id = $1
    )

    SELECT EXISTS (
      SELECT 1
      FROM categories c
      JOIN category_subtree subtree
        ON subtree.id = c.id
      WHERE c.id <> $2
        AND c.is_active = TRUE
    ) AS exists
  `,

  update: `
    WITH updated AS (
      UPDATE categories c
      SET
        name = CASE
          WHEN $3::boolean THEN $4::varchar
          ELSE c.name
        END,

        parent_id = CASE
          WHEN $5::boolean THEN $6::uuid
          ELSE c.parent_id
        END,

        sort_order = CASE
          WHEN $7::boolean THEN $8::integer
          ELSE c.sort_order
        END,

        is_active = CASE
          WHEN $9::boolean THEN $10::boolean
          ELSE c.is_active
        END

      WHERE c.id = $1
        AND c.household_id = $2
        AND c.is_system = FALSE

      RETURNING
        c.id,
        c.name,
        c.category_type,
        c.parent_id,
        c.is_system,
        c.is_active,
        c.sort_order,
        c.created_at,
        c.updated_at
    )

    SELECT
      u.id::text AS id,
      u.name,
      u.category_type AS "categoryType",

      u.parent_id::text AS "parentId",
      p.name AS "parentName",

      u.is_system AS "isSystem",
      u.is_active AS "isActive",
      u.sort_order AS "sortOrder",

      u.created_at AS "createdAt",
      u.updated_at AS "updatedAt"

    FROM updated u

    LEFT JOIN categories p
      ON p.id = u.parent_id
  `,
} as const;

export async function listCategories(
  householdId: string,
  filters: ListCategoriesQuery,
): Promise<CategoryRow[]> {
  const result = await db.query<CategoryRow>(CATEGORY_QUERIES.list, [
    householdId,
    filters.categoryType ?? null,
    filters.includeInactive ?? false,
  ]);

  return result.rows;
}

export async function getCategoryById(
  householdId: string,
  categoryId: string,
): Promise<CategoryRow | undefined> {
  const result = await db.query<CategoryRow>(CATEGORY_QUERIES.getById, [
    householdId,
    categoryId,
  ]);

  return result.rows[0];
}

export async function getActiveCategories(
  client: PoolClient,
  householdId: string,
  categoryId: string,
): Promise<CategoryRow | undefined> {
  const result = await client.query<CategoryRow>(
    CATEGORY_QUERIES.getActiveCategories,
    [householdId, categoryId],
  );

  return result.rows[0];
}

export async function getCategoryParentForCreate(
  client: PoolClient,
  householdId: string,
  parentId: string,
): Promise<CategoryParentRow | undefined> {
  const result = await client.query<CategoryParentRow>(
    CATEGORY_QUERIES.getParentForCreate,
    [parentId, householdId],
  );

  return result.rows[0];
}

export async function createCategory(
  client: PoolClient,
  householdId: string,
  values: CreateCategoryBody & {
    name: string;
    parentId: string | null;
    sortOrder: number;
  },
): Promise<CategoryRow | undefined> {
  const result = await client.query<CategoryRow>(CATEGORY_QUERIES.create, [
    householdId,
    values.parentId,
    values.name,
    values.categoryType,
    values.sortOrder,
  ]);

  return result.rows[0];
}

export async function lockHouseholdCategories(
  client: PoolClient,
  householdId: string,
): Promise<void> {
  await client.query(CATEGORY_QUERIES.lockHouseholdCategories, [householdId]);
}

export async function getCategoryForUpdate(
  client: PoolClient,
  householdId: string,
  categoryId: string,
): Promise<CategoryForUpdateRow | undefined> {
  const result = await client.query<CategoryForUpdateRow>(
    CATEGORY_QUERIES.getForUpdate,
    [householdId, categoryId],
  );

  return result.rows[0];
}

export async function isParentInCategorySubtree(
  client: PoolClient,
  householdId: string,
  categoryId: string,
  parentId: string,
): Promise<boolean> {
  const result = await client.query<CategoryExistsRow>(
    CATEGORY_QUERIES.isParentInSubtree,
    [householdId, categoryId, parentId],
  );

  return result.rows[0]?.exists ?? false;
}

export async function hasActiveCategoryDescendants(
  client: PoolClient,
  householdId: string,
  categoryId: string,
): Promise<boolean> {
  const result = await client.query<CategoryExistsRow>(
    CATEGORY_QUERIES.hasActiveDescendants,
    [householdId, categoryId],
  );

  return result.rows[0]?.exists ?? false;
}

export async function updateCategory(
  client: PoolClient,
  householdId: string,
  categoryId: string,
  values: UpdateCategoryBody,
): Promise<CategoryRow | undefined> {
  const result = await client.query<CategoryRow>(CATEGORY_QUERIES.update, [
    categoryId,
    householdId,
    values.name !== undefined,
    values.name ?? null,
    values.parentId !== undefined,
    values.parentId ?? null,
    values.sortOrder !== undefined,
    values.sortOrder ?? null,
    values.isActive !== undefined,
    values.isActive ?? null,
  ]);

  return result.rows[0];
}
