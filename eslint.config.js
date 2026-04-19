// eslint.config.js
import js from "@eslint/js";
import jsdoc from "eslint-plugin-jsdoc";
import globals from "globals";

export default [
  js.configs.recommended,
  jsdoc.configs["flat/recommended"],
  {
    languageOptions: {
      globals: {
        ...globals.browser, // fetch, window, localStorage, AbortSignal, etc.
      },
    },
    plugins: { jsdoc },
    rules: {
      // JSDoc rules - tune to your taste
      "jsdoc/require-returns-description": "off",  // return type alone is enough
      "jsdoc/require-param-description": "off",    // type alone is enough  
      "jsdoc/tag-lines": "off",                    // formatting preference
      "jsdoc/check-param-names": "error",          // catch param name mismatches
      "jsdoc/check-types": "error",                // catch typos in types
      "jsdoc/no-undefined-types": "warn",          // catch missing @typedef refs
    },
  },
];
