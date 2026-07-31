import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'release/**',
      'venv/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser, ...globals.webextensions },
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
      // A leading underscore is the conventional marker for a parameter that
      // exists to satisfy a signature rather than to be read.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'all' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
      // Chrome APIs are callback- and promise-hybrid; a floating promise there
      // is a real defect source, so the rule stays strict.
      '@typescript-eslint/no-floating-promises': 'error',
      'no-restricted-globals': [
        'error',
        { name: 'eval', message: 'Never evaluate page-provided strings as code.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'eval',
          message: 'Never evaluate page-provided strings as code.',
        },
      ],
    },
  },
  {
    // Build scripts are plain Node ESM and are not part of the TypeScript
    // program, so type-aware linting cannot apply to them.
    files: ['**/*.mjs', '*.config.js'],
    languageOptions: { globals: globals.node },
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      // Test doubles implement asynchronous interfaces with synchronous bodies,
      // and assert on discriminated unions the compiler has already narrowed.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      // `chrome.*` APIs are typed `any`, so narrowing their results inside an
      // in-page `evaluate` callback reads as redundant to the type checker even
      // though it is what makes the assertions meaningful.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
);
