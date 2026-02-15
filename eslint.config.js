export default [
  {
    files: ["apps/agent/src/**/*.js", "apps/studio-app/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        fetch: "readonly",
        URL: "readonly",
        TextDecoder: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      "eqeqeq": ["error", "always"],
      "curly": ["error", "multi-line"],
      "prefer-const": "warn",
    },
  },
  {
    ignores: [
      "node_modules/",
      "apps/studio-app/node_modules/",
      "apps/agent/node_modules/",
      "apps/studio-plugin/dist/",
      "apps/studio-app/release/",
      "dont-put/",
    ],
  },
];
