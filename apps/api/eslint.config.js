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
      // Prisma CLI tooling. These run through the Prisma CLI or bun, not the
      // Nest build, so they are outside tsconfig's project and the type-aware
      // parser cannot resolve them. Listing the directory rather than each file
      // stops the next script added here from breaking lint.
      "prisma.config.ts",
      "prisma/**",
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
