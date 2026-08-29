import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["app", "src", "components"];
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const EXCLUDED_PATHS = new Set(["app/privacy/page.tsx", "app/terms/page.tsx"]);

function productionFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    const stats = statSync(path);
    if (stats.isDirectory()) return productionFiles(path);
    const normalized = path.replaceAll("\\", "/");
    if (!CODE_EXTENSIONS.has(extname(path)) || EXCLUDED_PATHS.has(normalized)) return [];
    return [normalized];
  });
}

const RULES = [
  {
    name: "marketplace password or credential storage",
    pattern: /(?:marketplace|carrot|bunjang)[_A-Z0-9-]*(?:password|credential)|(?:password|credential)[_A-Z0-9-]*(?:marketplace|carrot|bunjang)/i,
  },
  {
    name: "automated marketplace login/posting",
    pattern: /(?:auto(?:matic)?[_-]?(?:login|post|publish)|cross[_-]?post|marketplace[_-]?(?:login|post|publish))/i,
  },
  {
    name: "Carrot/Bunjang scraping implementation",
    pattern: /(?:carrot|bunjang|당근|번개장터).{0,120}(?:scrap|crawl|puppeteer|playwright|fetch\s*\(|axios)|(?:scrap|crawl|puppeteer|playwright|fetch\s*\(|axios).{0,120}(?:carrot|bunjang|당근|번개장터)/is,
  },
  {
    name: "internal buyer/seller chat or escrow/payment flow",
    pattern: /(?:buyer.{0,60}seller|seller.{0,60}buyer).{0,100}(?:chat|payment|escrow)|(?:chat|payment|escrow).{0,100}(?:buyer.{0,60}seller|seller.{0,60}buyer)/is,
  },
  {
    name: "external analytics SDK or tag",
    pattern: /(?:posthog|amplitude|mixpanel|segment\.io|googletagmanager\.com|google-analytics\.com|\bgtag\s*\(|@vercel\/analytics)/i,
  },
] as const;

const BANNED_ANALYTICS_PACKAGES = new Set([
  "posthog-js",
  "posthog-node",
  "@amplitude/analytics-browser",
  "@amplitude/analytics-node",
  "mixpanel",
  "mixpanel-browser",
  "@segment/analytics-next",
  "@segment/analytics-node",
  "@vercel/analytics",
  "react-ga4",
]);

describe("forbidden MVP feature scan", () => {
  it("contains no marketplace automation, scraping, credential storage, internal trade, or external analytics implementation", () => {
    const findings: string[] = [];

    for (const file of ROOTS.flatMap(productionFiles)) {
      const source = readFileSync(file, "utf8");
      for (const rule of RULES) {
        if (rule.pattern.test(source)) findings.push(`${file}: ${rule.name}`);
      }
    }

    expect(findings).toEqual([]);
  });

  it("does not install an external product analytics SDK", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const installed = new Set([
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
    ]);

    expect([...installed].filter((name) => BANNED_ANALYTICS_PACKAGES.has(name))).toEqual([]);
  });
});
