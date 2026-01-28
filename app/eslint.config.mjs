import nextVitals from "eslint-config-next/core-web-vitals";
import drizzle from "eslint-plugin-drizzle";
import eslintReact from "@eslint-react/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

const config = [
  {
    ignores: [
      "**/*.js",
      "**/*.jsx",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "node_modules/**",
    ],
  },
  ...nextVitals,
  {
    files: ["**/*.ts", "**/*.tsx"],
    ...eslintReact.configs["recommended-typescript"],
    plugins: {
      ...eslintReact.configs["recommended-typescript"].plugins,
      drizzle,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...eslintReact.configs["recommended-typescript"].rules,

      // React hooks rules
      "@eslint-react/hooks-extra/no-direct-set-state-in-use-effect": "off",
      "@eslint-react/naming-convention/use-state": "off",
      "@eslint-react/no-array-index-key": "off",
      "@eslint-react/no-use-context": "off",

      // TypeScript rules - these extend the nextVitals config which includes typescript-eslint
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/prefer-nullish-coalescing": "off",
      "@typescript-eslint/only-throw-error": "off",
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-explicit-any": "off",

      "@typescript-eslint/consistent-type-imports": [
        "warn",
        {
          prefer: "type-imports",
          fixStyle: "inline-type-imports",
        },
      ],

      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
        },
      ],

      "@typescript-eslint/require-await": "off",

      "@typescript-eslint/no-misused-promises": [
        "error",
        {
          checksVoidReturn: {
            attributes: false,
          },
        },
      ],

      // Drizzle rules
      "drizzle/enforce-delete-with-where": [
        "error",
        {
          drizzleObjectName: ["db", "ctx.db"],
        },
      ],

      "drizzle/enforce-update-with-where": [
        "error",
        {
          drizzleObjectName: ["db", "ctx.db"],
        },
      ],
    },
  },
];

export default config;
