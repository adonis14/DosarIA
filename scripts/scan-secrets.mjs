#!/usr/bin/env node
/**
 * Lightweight secret scan (complements, does not replace, a dedicated
 * scanner such as gitleaks or GitHub secret scanning in CI).
 *
 *  1. Source tree: files that would be committed must not contain credential
 *     patterns or the actual values configured in .env.local.
 *  2. Browser bundles (.next/static): must not contain ANY Supabase key; the
 *     browser never talks to Supabase directly.
 */
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PATTERNS = [
  { name: "Supabase secret key", re: /sb_secret_[A-Za-z0-9_-]{20,}/ },
  { name: "Supabase publishable key", re: /sb_publishable_[A-Za-z0-9_-]{20,}/ },
  { name: "JWT", re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "private key", re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "AWS access key", re: /AKIA[0-9A-Z]{16}/ },
  { name: "Postgres URL with password", re: /postgres(ql)?:\/\/[^:\s]+:[^@\s]{6,}@(?!127\.0\.0\.1|localhost)/ },
];

const envValues = [];
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^(SUPABASE_SECRET_KEY|SUPABASE_PUBLISHABLE_KEY|DEMO_PASSWORD)=(.+)$/);
    if (m && m[2].length >= 12) envValues.push({ name: m[1], value: m[2].trim() });
  }
}

function trackedFiles() {
  try {
    const out = execSync("git ls-files --cached --others --exclude-standard", { encoding: "utf8" });
    return out.split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

let findings = 0;
const report = (file, what) => {
  findings++;
  console.error(`  ✗ ${file}: ${what}`);
};

console.log("Scanning files that would be committed…");
for (const file of trackedFiles()) {
  if (/\.(png|jpg|ico|woff2?|lock)$/.test(file) || file === "package-lock.json") continue;
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const p of PATTERNS) if (p.re.test(text)) report(file, p.name);
  for (const v of envValues) if (text.includes(v.value)) report(file, `value of ${v.name}`);
}

console.log("Scanning browser bundles (.next/static)…");
const bundles = walk(".next/static").filter((f) => /\.(js|css|html|json)$/.test(f));
if (bundles.length === 0) console.log("  (no build found — run `npm run build` to include bundles)");
for (const file of bundles) {
  const text = readFileSync(file, "utf8");
  for (const p of PATTERNS) if (p.re.test(text)) report(file, p.name);
  for (const v of envValues) if (text.includes(v.value)) report(file, `value of ${v.name}`);
  if (/SUPABASE_SECRET_KEY|service_role/.test(text)) report(file, "privileged credential reference");
}

if (findings > 0) {
  console.error(`\n${findings} potential secret(s) found.`);
  process.exit(1);
}
console.log("No secrets found.");
