// ESLint flat config. The rule set is pebble's TypeScript pack (standards/rules/typescript.md).
// Complexity thresholds follow the product design: complexity 10, max-depth 3,
// max-params 3, max-lines-per-function 60. Test code keeps every rule except the size limits and
// the magic-number rule, which fixtures and test data would only satisfy by naming every literal.
import eslint from "@eslint/js";
import comments from "@eslint-community/eslint-plugin-eslint-comments";
import { importX } from "eslint-plugin-import-x";
import tseslint from "typescript-eslint";

const sizeLimits = {
  complexity: ["error", 10],
  "max-depth": ["error", 3],
  "max-params": ["error", 3],
  "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true }],
};

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/generated/**",
      "coverage/**",
      "*.config.js",
      "*.config.ts",
      "**/*.cjs",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "import-x": importX, "@eslint-community/eslint-comments": comments },
    settings: { "import-x/internal-regex": "^@stackpuddle/" },
    rules: {
      // type-strict
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      // exhaustive-match
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      // unfinished-code
      "no-console": "error",
      "no-debugger": "error",
      "no-warning-comments": [
        "error",
        { terms: ["todo", "fixme", "xxx", "hack"], location: "anywhere" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
      "no-unreachable": "error",
      // config-access
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message: "Read configuration through a config port.",
        },
      ],
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "dotenv", message: "Read configuration through a config port." }] },
      ],
      // suppression-reasons
      "@eslint-community/eslint-comments/require-description": "error",
      "@eslint-community/eslint-comments/no-unlimited-disable": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-expect-error": "allow-with-description",
          "ts-ignore": true,
          "ts-nocheck": true,
          "ts-check": false,
          minimumDescriptionLength: 10,
        },
      ],
      // imports: external, workspace, local
      "import-x/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      "import-x/no-duplicates": "error",
      // Exported functions declare return types.
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },
  {
    // The packages: size limits, named constants and no string-literal keys into records.
    files: ["packages/**/*.ts"],
    rules: {
      ...sizeLimits,
      "@typescript-eslint/no-magic-numbers": [
        "error",
        {
          ignore: [-1, 0, 1, 2],
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          ignoreEnums: true,
          ignoreReadonlyClassProperties: true,
          ignoreTypeIndexes: true,
          enforceConst: true,
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[computed=true] > Literal.property[value=/^[A-Za-z_][A-Za-z0-9_]*$/]",
          message:
            "Use property access; string-literal keys into records belong to the module that owns the record.",
        },
      ],
    },
  },
  {
    // Brand constructors and handle builders assert a branded or mapped type once, after checking it.
    files: [
      "packages/sdk/src/model/names.ts",
      "packages/sdk/src/model/quantities.ts",
      "packages/sdk/src/model/workload.ts",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "as", objectLiteralTypeAssertions: "never" },
      ],
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "as", objectLiteralTypeAssertions: "allow" },
      ],
      "@typescript-eslint/no-unsafe-type-assertion": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-deprecated": "error",
    },
  },
);
