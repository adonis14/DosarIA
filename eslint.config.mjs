import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Security guard rail: the privileged (service-role) client may only be
  // imported by the two reviewed server modules. Everything else must use
  // the user-scoped, RLS-enforced client.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/server/monitoring/check-case.ts", "src/server/dal/audit.ts", "src/lib/supabase/admin.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/supabase/admin",
              message: "The service-role client bypasses RLS. Only check-case.ts and dal/audit.ts may use it.",
            },
          ],
          patterns: [
            {
              group: ["**/supabase/admin"],
              message: "The service-role client bypasses RLS. Only check-case.ts and dal/audit.ts may use it.",
            },
          ],
        },
      ],
    },
  },
  // Client components must never read server environment or server modules.
  {
    files: ["src/components/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/server/*", "@/lib/env", "@/lib/supabase/*"], message: "UI components must not import server-only modules." },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "playwright-report/**", "test-results/**"]),
]);

export default eslintConfig;
