import type { CodegenConfig } from '@graphql-codegen/cli';

/**
 * GraphQL Codegen for the PACKET/QUESTION domain.
 *
 * sockbowl-questions is the single source of truth for the packet contract.
 * Its GraphQL schema is synced into this repo via scripts/sync-schema.sh and
 * the packet TypeScript types are generated from it here -- they must NOT be
 * hand-maintained.
 *
 * maybeValue: 'T' + avoidOptionals keep the generated shapes non-nullable /
 * non-optional, matching how the existing UI consumes the packet domain.
 */
const config: CodegenConfig = {
  schema: 'src/app/game/models/sockbowl/questions-schema.graphqls',
  generates: {
    'src/app/game/models/sockbowl/packet-types.generated.ts': {
      plugins: ['typescript'],
      config: {
        maybeValue: 'T',
        avoidOptionals: true,
        skipTypename: true,
        enumsAsTypes: true,
        scalars: { ID: 'string' },
      },
    },
  },
};

export default config;
