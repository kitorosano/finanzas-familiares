import type { FastifySchema } from 'fastify';

import {
  AUDIT_CURSOR_PATTERN,
  AUDIT_ENTITY_NAME_PATTERN,
} from '../../constants/patterns.js';

import { AUDIT_ACTIONS } from './audit.constants.js';

export const AUDIT_LIST_SCHEMA = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 100,
        default: 50,
      },
      cursor: {
        type: 'string',
        minLength: 1,
        maxLength: 256,
        pattern: AUDIT_CURSOR_PATTERN,
      },
      action: {
        type: 'string',
        enum: [...AUDIT_ACTIONS],
      },
      entityName: {
        type: 'string',
        minLength: 1,
        maxLength: 100,
        pattern: AUDIT_ENTITY_NAME_PATTERN,
      },
    },
  },
} satisfies FastifySchema;
