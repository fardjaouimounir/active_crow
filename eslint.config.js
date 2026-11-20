import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { createNodeResolver, importX } from 'eslint-plugin-import-x';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

/** Patterns forbidding one app from importing the other, by package name or by path. */
function otherAppPatterns(appName) {
  const message = 'apps must not import each other; move shared code to packages/shared.';
  return [
    { group: [`@fieldflow/${appName}`, `@fieldflow/${appName}/*`], message },
    { regex: `(^|/)apps/${appName}(/|$)`, message },
  ];
}

/** Only src/db/client.js talks to Prisma; everything else imports `prisma` from there. */
const prismaPatterns = [
  {
    group: ['@prisma/client', '@prisma/client/*', '@prisma/adapter-pg'],
    message: 'Import the database client from src/db/client.js, not from Prisma directly.',
  },
];

/** `no-restricted-imports` with the given pattern lists (a later block replaces, not merges, this rule). */
const restrictImports = (...patternLists) => ({
  'no-restricted-imports': ['error', { patterns: patternLists.flat() }],
});

export default [
  {
    ignores: ['**/node_modules/', '**/dist/', '**/coverage/', '.claude/'],
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
      'no-restricted-properties': [
        'error',
        { property: '$queryRawUnsafe', message: 'Use a parameterized Prisma tagged template.' },
      ],
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
    files: ['**/*.{js,mjs}'],
    ignores: ['apps/web/src/**', 'apps/web/test/**'],
    languageOptions: { globals: { ...globals.node } },
  },

  // API
  {
    files: ['apps/api/**/*.{js,mjs}'],
    rules: restrictImports(otherAppPatterns('web'), prismaPatterns),
  },
  {
    // The only places allowed to import Prisma directly.
    files: [
      'apps/api/src/db/client.js',
      'apps/api/prisma/seed/**/*.js',
      'apps/api/src/db/__tests__/**/*.js',
    ],
    rules: restrictImports(otherAppPatterns('web')),
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
      ...restrictImports(otherAppPatterns('api')),
    },
  },

  prettier,
];
