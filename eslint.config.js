// Lint de la plateforme (packages/*, server/plateforme, worker). Le code
// historique (Simulateur, Prospection) n'est pas couvert : voir `npm run lint`.
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'public/**', 'data/**', 'uploads/**', 'knowledge_base/**'] },
  js.configs.recommended,
  {
    files: ['packages/**/*.js', 'server/plateforme/**/*.js', 'server/worker.js', 'server/migrations/02*.js', 'scripts/**/*.js', 'eval/bench/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
