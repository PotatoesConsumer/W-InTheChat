import js from "@eslint/js";
import globals from "globals";

// Correctness rules only; formatting is Prettier's job (npm run format).
export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      // src/events runs in both the browser and Node. Split these once the game code lands.
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
];
