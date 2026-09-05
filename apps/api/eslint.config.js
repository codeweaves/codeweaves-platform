import { config } from "@repo/eslint-config/base";

/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    ignores: [
      "dist/**",
      "coverage/**",
      // Local RAG eval harness build output (untracked). Not source.
      "eval/.build/**",
      "node_modules/**",
      "generated/**",
      "eslint.config.js",
      "*.cjs",
      "prisma.config.ts",
      "prisma/seed.ts",
      "prisma/seed-analytics.ts",
      "prisma/seed-demo-agents.ts",
    ],
  },
  ...config,
  {
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["test/**/*.ts", "src/main.ts"],
    rules: {
      "turbo/no-undeclared-env-vars": "off",
    },
  },
];
