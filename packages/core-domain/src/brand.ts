/**
 * Product identity is presentation/configuration data. Runtime policy must not
 * branch on any of these values.
 */
export interface BrandConfig {
  productName: string;
  assistantName: string;
  wakeWord: string;
}

export const DEFAULT_BRAND: Readonly<BrandConfig> = Object.freeze({
  productName: "AURA",
  assistantName: "AURA",
  wakeWord: "Hey AURA",
});

export type BrandOverrides = Partial<Record<keyof BrandConfig, string | undefined>>;

export function resolveBrand(overrides: BrandOverrides = {}): BrandConfig {
  return {
    productName: nonEmpty(overrides.productName, DEFAULT_BRAND.productName),
    assistantName: nonEmpty(overrides.assistantName, DEFAULT_BRAND.assistantName),
    wakeWord: nonEmpty(overrides.wakeWord, DEFAULT_BRAND.wakeWord),
  };
}

export function brandFromEnvironment(environment: Record<string, string | undefined>): BrandConfig {
  return resolveBrand({
    productName: environment.AURA_PRODUCT_NAME,
    assistantName: environment.AURA_ASSISTANT_NAME,
    wakeWord: environment.AURA_WAKE_WORD,
  });
}

function nonEmpty(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}
