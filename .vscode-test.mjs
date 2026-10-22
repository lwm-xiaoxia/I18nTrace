import { defineConfig } from '@vscode/test-cli';

export default defineConfig([
  {
    label: 'single-project',
    files: 'out/test/**/*.test.js',
    workspaceFolder: './test-fixtures',
    mocha: {
      ui: 'bdd',
      timeout: 20000,
    },
  },
  {
    label: 'multi-project',
    files: 'out/test-project/**/*.test.js',
    workspaceFolder: './test-project-fixtures/projects.code-workspace',
    mocha: {
      ui: 'bdd',
      timeout: 20000,
    },
  },
]);
