import { testEnv } from "../helpers/env";

// Fail fast (and never against a remote project).
const env = testEnv();
process.env.APP_URL ??= "http://localhost:3000";
process.env.SUPABASE_URL = env.url;
process.env.SUPABASE_PUBLISHABLE_KEY = env.publishable;
process.env.SUPABASE_SECRET_KEY = env.secret;
process.env.MOCK_COURT_LATENCY_MS = "0";
