import type { FastifySchema } from 'fastify';

import {
  AUDIT_CURSOR_PATTERN,
  AUDIT_ENTITY_NAME_PATTERN,
} from '../../constants/patterns.js';
import { SCHEMA_ADDITIONAL_PROPERTIES } from '../../constants/schema.js';

import {
  AUDIT_ACTIONS,
  AUDIT_CURSOR_MAX_LENGTH,
  AUDIT_CURSOR_MIN_LENGTH,
  AUDIT_ENTITY_NAME_MAX_LENGTH,
  AUDIT_ENTITY_NAME_MIN_LENGTH,
  AUDIT_LIST_LIMIT_DEFAULT,
  AUDIT_LIST_LIMIT_MAX,
  AUDIT_LIST_LIMIT_MIN,
} from './audit.constants.js';

export const AUDIT_LIST_SCHEMA = {
  querystring: {
    type: 'object',
    additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,
    properties: {
      limit: {
        type: 'integer',
        minimum: AUDIT_LIST_LIMIT_MIN,
        maximum: AUDIT_LIST_LIMIT_MAX,
        default: AUDIT_LIST_LIMIT_DEFAULT,
      },
      cursor: {
        type: 'string',
        minLength: AUDIT_CURSOR_MIN_LENGTH,
        maxLength: AUDIT_CURSOR_MAX_LENGTH,
        pattern: AUDIT_CURSOR_PATTERN,
      },
      action: {
        type: 'string',
        enum: [...AUDIT_ACTIONS],
      },
      entityName: {
        type: 'string',
        minLength: AUDIT_ENTITY_NAME_MIN_LENGTH,
        maxLength: AUDIT_ENTITY_NAME_MAX_LENGTH,
        pattern: AUDIT_ENTITY_NAME_PATTERN,
      },
    },
  },
} satisfies FastifySchema;
