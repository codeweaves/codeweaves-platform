import { config } from "@repo/eslint-config/base";

/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "node_modules/**",
      "generated/**",
      "eslint.config.js",
      "jest.config.js",
      "jest.e2e.config.js",
      "prisma.config.ts",
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
