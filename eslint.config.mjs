// @ts-check
import angular from 'angular-eslint';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '.angular/**', 'e2e/**', '**/*.cjs', '**/*.js'] },
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommended, prettier],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error'] }]
    }
  },
  {
    // Frontends Angular: regras do framework + lint dos templates embutidos nos componentes.
    files: ['apps/web/**/*.ts', 'apps/admin/**/*.ts', 'libs/front/**/*.ts'],
    extends: [...angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/component-selector': ['error', { type: 'element', prefix: ['ps', 'pa'], style: 'kebab-case' }],
      '@angular-eslint/component-class-suffix': ['error', { suffixes: ['Component', 'Page'] }],
      '@angular-eslint/prefer-on-push-component-change-detection': 'error'
    }
  },
  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility]
  },
  {
    // Scripts de linha de comando escrevem no terminal de propósito.
    files: ['apps/api/scripts/**/*.ts'],
    rules: { 'no-console': 'off' }
  }
);
