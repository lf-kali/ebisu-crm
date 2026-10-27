import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/.turbo/**', 'docs/**'] },
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
          'TemplateElement[value.raw=/set_config|app\\.tenant_id/i]',
          'Literal[value=/set_config|app\\.tenant_id/i]',
        ].map((selector) => ({
          selector,
          message: 'Contexto de tenant só via comTenant/clienteDoTenant (@ebisu/db).',
        })),
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
