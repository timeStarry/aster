export const MANIFEST_SCHEMA = {
  type: 'object',
  required: ['id','name','version','apiVersion','description','permissions','activation','contributes'],
  properties: {
    id:          { type: 'string', pattern: '^[a-z][a-z0-9]*(\\.[a-z][a-z0-9]*)+$' },
    name:        { type: 'string' },
    version:     { type: 'string' },
    apiVersion:  { type: 'string', enum: ['1'] },
    description: { type: 'string' },
    permissions: { type: 'array', items: { type: 'string' } },
    activation:  { type: 'array', items: { type: 'string' } },
    frontend:    { type: 'string' },
    backend:     { type: ['string','null'] },
    contributes: { type: 'object' },
  },
  additionalProperties: true,
} as const;
