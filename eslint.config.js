import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist', 'coverage'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  { languageOptions: { parserOptions: { projectService: true } } },
  { files: ['*.config.js'], extends: [tseslint.configs.disableTypeChecked] },
  {
    // node:test's describe and it return promises the runner tracks itself.
    files: ['test/**'],
    rules: { '@typescript-eslint/no-floating-promises': 'off' },
  },
  prettier,
);
