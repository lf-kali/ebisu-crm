import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/.turbo/**', 'docs/**', '**/routeTree.gen.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // SEG-6: o contexto de tenant só é definido por packages/db/src/tenancy.ts (comTenant e
    // clienteDoTenant). SQL manual com set_config/app.tenant_id em outro lugar pode trocar
    // o tenant no meio de uma transação.
    files: ['**/*.{ts,tsx,mjs,js}'],
    ignores: [
      'eslint.config.mjs',
      'packages/db/src/tenancy.ts',
      '**/test/**',
      '**/*.test.{ts,tsx}',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...[
          'TemplateElement[value.raw=/set_config|app\\.tenant_id|app\\.membro_id|app\\.api_key_id|app\\.request_id|app\\.ip\\b/i]',
          'Literal[value=/set_config|app\\.tenant_id|app\\.membro_id|app\\.api_key_id|app\\.request_id|app\\.ip\\b/i]',
        ].map((selector) => ({
          selector,
          message:
            'Contexto de tenant e autor (app.*) só via comTenant/clienteDoTenant (@ebisu/db).',
        })),
      ],
    },
  },
  {
    // Spec §7: dados de domínio só via executarComando (core/tx) e repositórios. Fora deles, um
    // módulo não abre transação nem usa o cliente Prisma; tipos continuam liberados.
    files: ['apps/api/src/modules/**/*.ts'],
    ignores: [
      'apps/api/src/modules/auth/**',
      'apps/api/src/modules/eu/**',
      'apps/api/src/modules/**/*.repositorio.ts',
    ],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: ['@ebisu/db', '@prisma/client'].map((name) => ({
            name,
            message: 'Acesso a dados só via executarComando (core/tx) ou *.repositorio.ts.',
            allowTypeImports: true,
          })),
          patterns: [
            {
              group: ['@ebisu/db/*', '@prisma/client/*'],
              message: 'Acesso a dados só via executarComando (core/tx) ou *.repositorio.ts.',
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  prettier,
);
