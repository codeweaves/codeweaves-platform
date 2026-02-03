import jest from "eslint-plugin-jest";

/**
 * ESLint configuration for Jest test files.
 * Apply to test files using the pattern: ["**/*.spec.ts", "**/*.test.ts", "**/*.e2e-spec.ts"]
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const jestConfig = [
  {
    files: [
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.e2e-spec.ts",
      "**/test/**/*.ts",
    ],
    plugins: {
      jest,
    },
    languageOptions: {
      globals: {
        ...jest.environments.globals.globals,
      },
    },
    rules: {
      // Recommended Jest rules
      "jest/expect-expect": "warn",
      "jest/no-disabled-tests": "warn",
      "jest/no-focused-tests": "error",
      "jest/no-identical-title": "error",
      "jest/prefer-to-have-length": "warn",
      "jest/valid-expect": "error",

      // Additional best practices
      "jest/no-conditional-expect": "error",
      "jest/no-export": "error",
      "jest/no-mocks-import": "error",
      "jest/no-standalone-expect": "error",
      "jest/prefer-called-with": "warn",
      "jest/prefer-spy-on": "warn",
      "jest/prefer-to-be": "warn",
      "jest/prefer-to-contain": "warn",
      "jest/prefer-strict-equal": "warn",

      // Allow any types in tests for flexibility
      "@typescript-eslint/no-explicit-any": "off",

      // Allow unused vars in test files (useful for destructuring)
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
];

export default jestConfig;
