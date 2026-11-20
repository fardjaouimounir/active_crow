import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { createNodeResolver, importX } from 'eslint-plugin-import-x';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

/** Forbids one app from importing the other, by package name or by path. */
function forbidApp(appName) {
  const message = `apps must not import each other; move shared code to packages/shared.`;
  return {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          { group: [`@fieldflow/${appName}`, `@fieldflow/${appName}/*`], message },
          { regex: `(^|/)apps/${appName}(/|$)`, message },
        ],
      },
    ],
  };
}

export default [
  {
    ignores: ['**/node_modules/', '**/dist/', '**/coverage/'],
  },

  js.configs.recommended,

  {
    files: ['**/*.{js,jsx}'],
    plugins: { 'import-x': importX },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: {
      'import-x/resolver-next': [createNodeResolver()],
    },
    rules: {
      'no-console': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'import-x/no-cycle': 'error',
      'import-x/no-unresolved': 'error',
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            { target: './apps/web', from: './apps/api', message: 'web must not import api.' },
            { target: './apps/api', from: './apps/web', message: 'api must not import web.' },
            {
              target: './packages',
              from: './apps',
              message: 'shared packages must not depend on apps.',
            },
          ],
        },
      ],
    },
  },

  // Node.js code: API, shared package, tooling and config files (everything but the browser app)
  {
    files: ['**/*.js'],
    ignores: ['apps/web/src/**', 'apps/web/test/**'],
    languageOptions: { globals: { ...globals.node } },
  },

  // API
  {
    files: ['apps/api/**/*.js'],
    rules: forbidApp('web'),
  },
  {
    // Bootstrap fallback when the logger itself failed.
    files: ['apps/api/src/server.js'],
    rules: { 'no-console': 'off' },
  },

  // Web
  {
    files: ['apps/web/src/**/*.{js,jsx}', 'apps/web/test/**/*.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...forbidApp('api'),
    },
  },

  prettier,
];
