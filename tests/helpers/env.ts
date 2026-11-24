import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

export function testEnv() {
  const url = process.env.SUPABASE_URL;
  const publishable = process.env.SUPABASE_PUBLISHABLE_KEY;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !publishable || !secret) {
    throw new Error("Missing local Supabase env. Run `npx supabase start` then `npm run env:local`.");
  }
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
    // Tests create and mutate data: never point them at a remote project.
    throw new Error("Integration tests must run against a LOCAL Supabase instance.");
  }
  return { url, publishable, secret };
}
