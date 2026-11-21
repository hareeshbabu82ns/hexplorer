import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import tailwindcss from "eslint-plugin-tailwindcss";

export default defineConfig([
  globalIgnores([".next/**", "node_modules/**", "public/**", "data/**", "next-env.d.ts", "**/*.esm.js"]),
  ...nextCoreWebVitals,
  ...nextTypescript,
  tailwindcss.configs.recommended,
  prettier,
  {
    settings: {
      tailwindcss: {
        cssConfigPath: "./src/app/globals.css",
        functions: ["cn", "cva", "clsx"],
      },
      next: { rootDir: ["./"] },
    },
    rules: {
      "@next/next/no-html-link-for-pages": "off",
      "react/jsx-key": "off",
      "tailwindcss/no-custom-classname": "off",
      // the v4 plugin orders classes differently from v3; re-enable and run --fix to adopt it
      "tailwindcss/classnames-order": "off",
      // existing code base: keep these as warnings rather than failing lint
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }],
    },
  },
]);
