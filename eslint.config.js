// ESLint 9 flat config — the migration of the old `.eslintrc.cjs` (which ESLint
// 9 no longer reads). Deliberately scoped: typescript-eslint's non-type-checked
// recommended rules + the two classic react-hooks rules + the project's prior
// custom tuning. No `no-undef` / `eslint:recommended` — TypeScript and
// `pnpm typecheck` are the authority for type/undefined correctness, so this
// stays fast (no project type graph) and low-noise.

import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  {
    ignores: [
      'dist/**',
      'dist-server/**',
      'coverage/**',
      'node_modules/**',
      'public/**',
      // Generated icon catalog — huge and machine-written, not worth linting.
      'src/icons/catalog.generated.ts',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // Only the two long-standing react-hooks rules. (react-hooks v7 also ships
      // the strict React-Compiler suite, which this non-compiler codebase isn't
      // written against — intentionally not enabled.)
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Carried over from the old .eslintrc.cjs:
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
]
