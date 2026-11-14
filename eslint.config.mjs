import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: [
      ".next/**",
      ".next-e2e/**",
      "node_modules/**",
      "database/migrations/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
      // Upwork sync working files (job data, local one-off scripts); gitignored.
      ".upwork-sync/**",
      // Git worktrees used during development; each is linted in its own checkout. Gitignored.
      ".claude/worktrees/**",
    ],
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
];

export default config;
