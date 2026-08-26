import "server-only";

/**
 * Credit package configuration (blueprint §8): values flow from env so
 * pricing is configurable without touching business logic.
 */
export interface CreditPackage {
  id: string;
  label: string;
  genWei: bigint;
  credits: number;
}

interface RawPackage {
  id: string;
  gen_wei: string;
  credits: number;
}

function loadPackages(): CreditPackage[] {
  const fallback: RawPackage[] = [
    { id: "starter", gen_wei: "1000000000000000000", credits: 10 },
    { id: "double", gen_wei: "2000000000000000000", credits: 20 },
    { id: "jury", gen_wei: "5000000000000000000", credits: 50 },
  ];

  let raw: RawPackage[] = fallback;
  try {
    const parsed = JSON.parse(
      process.env.CREDIT_PACKAGES_JSON || "",
    ) as Partial<{ packages: RawPackage[] }>;
    if (Array.isArray(parsed.packages) && parsed.packages.length > 0) {
      raw = parsed.packages;
    }
  } catch {
    // fall back to defaults
  }

  return raw
    .filter((pkg) => pkg.id && BigInt(pkg.gen_wei || "0") > 0n && pkg.credits > 0)
    .map((pkg) => ({
      id: pkg.id,
      label: `${BigInt(pkg.gen_wei) / 10n ** 18n} GEN`,
      genWei: BigInt(pkg.gen_wei),
      credits: pkg.credits,
    }));
}

export const CREDIT_PACKAGES = loadPackages();

export const ROAST_COST_CREDITS = Number(process.env.ROAST_COST_CREDITS || "5");

export function findPackage(id: string): CreditPackage | undefined {
  return CREDIT_PACKAGES.find((pkg) => pkg.id === id);
}
