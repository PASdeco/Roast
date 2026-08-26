import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Secrets live in the repo-root .env (Roast/.env), one level above web/.
 * Next.js only auto-loads .env from the app root, so we bridge it here at
 * server start. Values are server-side only — nothing is exposed to the
 * client bundle unless prefixed with NEXT_PUBLIC_.
 */
try {
  for (const line of readFileSync(resolve(__dirname, "../.env"), "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].trim();
    }
  }
} catch {
  // root .env missing — server routes will report unconfigured honestly
}

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
