const expo = require('eslint-config-expo/flat');
const prettier = require('eslint-config-prettier');

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  ...expo,
  prettier,
  {
    ignores: ['**/node_modules/**', '.expo/**', 'coverage/**', 'dist/**', 'patches/**'],
  },
];
