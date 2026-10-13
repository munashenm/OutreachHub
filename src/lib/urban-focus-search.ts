import { parseStoreCataloguePage, type ParsedStoreProduct } from "./catalogue-reconcile";
import { compareRequirement, type ProductRequirement, type SourcingCandidate } from "./sourcing";

export function urbanFocusSearchQueries(requirements: ProductRequirement[]) {
  const queries: Array<{ q?: string; sku?: string; mpn?: string }> = [];
  for (const requirement of requirements.slice(0, 6)) {
    const sku = requirement.sku.trim();
    const mpn = requirement.mpn.trim();
    if (sku.length >= 2) queries.push({ sku });
    if (mpn.length >= 3) queries.push({ mpn });
    const named = [requirement.model, requirement.brandPreference, requirement.productType]
      .map((value) => value.trim())
      .filter((value) => value.length >= 3)
      .join(" ");
    const text = named || requirement.requestedText.replace(/\s+/g, " ").trim().slice(0, 120);
    if (text.length >= 3) queries.push({ q: text });
  }
  const seen = new Set<string>();
  return queries.filter((query) => {
    const key = `${query.q ?? ""}|${query.sku ?? ""}|${query.mpn ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
}

export class UrbanFocusCatalogueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrbanFocusCatalogueError";
  }
}

/** A failed or unreadable catalogue response is not evidence that Urban Focus has no stock. */
export function urbanFocusCatalogueHold(input: { error?: unknown; body?: unknown }): string | null {
  if ("error" in input && input.error !== undefined) {
    const message = input.error instanceof Error ? input.error.message : "";
    if (/rejected the API key/i.test(message)) return "The Urban Focus catalogue rejected the connection. The request was held and was not quoted from another source.";
    if (/timeout|timed out|aborted/i.test(message)) return "The Urban Focus catalogue did not respond in time. The request was held and was not quoted from another source.";
    if (/returned \d+/i.test(message)) return "The Urban Focus catalogue returned an error. The request was held and was not quoted from another source.";
    return "The Urban Focus catalogue could not be read. The request was held and was not quoted from another source.";
  }
  if (input.body == null) return "The Urban Focus catalogue did not return a search result. The request was held and was not quoted from another source.";
  const parsed = parseUrbanFocusSearch(input.body);
  if ("error" in parsed) return "The Urban Focus catalogue returned a response that could not be read. The request was held and was not quoted from another source.";
  return null;
}

export function parseUrbanFocusSearch(body: unknown): ParsedStoreProduct[] | { error: string } {
  if (body && typeof body === "object" && !Array.isArray(body) && Array.isArray((body as { products?: unknown }).products) && !("page" in (body as object))) {
    const products = (body as { products: unknown[] }).products;
    const wrapped = parseStoreCataloguePage({
      page: 1,
      perPage: Math.max(1, products.length),
      total: products.length,
      lastPage: 1,
      products,
    });
    return "error" in wrapped ? wrapped : wrapped.products;
  }
  const page = parseStoreCataloguePage(body);
  return "error" in page ? page : page.products;
}

export function relevantStoreProducts(products: readonly ParsedStoreProduct[], query: { q?: string; sku?: string; mpn?: string }) {
  const exact = [query.sku, query.mpn]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter((value) => value.length >= 2);
  const tokens = [query.q]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => value.toLowerCase().split(/[^a-z0-9]+/))
    .filter((token) => token.length >= 3);
  if (exact.length === 0 && tokens.length === 0) return [];
  return products.filter((product) => {
    const hay = `${product.name} ${product.sku} ${product.manufacturerPartNumber} ${product.brand} ${product.specifications} ${product.description}`.toLowerCase();
    const compact = hay.replace(/[^a-z0-9]/g, "");
    return exact.some((value) => compact.includes(value)) || tokens.some((token) => hay.includes(token));
  });
}

export function urbanFocusSupplies(requirement: ProductRequirement, catalogue: readonly SourcingCandidate[]) {
  const quantity = Math.max(1, requirement.quantity ?? 1);
  return catalogue.some((candidate) => {
    if (candidate.sourceKind !== "URBAN_FOCUS_CATALOGUE" || candidate.vatKnown === false) return false;
    if (!candidate.stockKnown || !candidate.fresh || (candidate.stockQty ?? 0) < quantity) return false;
    if ((candidate.listedPriceCents ?? 0) <= 0) return false;
    const grade = compareRequirement(requirement, candidate);
    return grade === "EXACT" || grade === "MEETS_REQUIREMENT" || grade === "EXCEEDS_REQUIREMENT";
  });
}

export function urbanFocusCandidate(product: ParsedStoreProduct, checkedAt: string): SourcingCandidate {
  const listed = product.salePriceCents && product.salePriceCents > 0 ? product.salePriceCents : product.unitPriceCents;
  return {
    sourceKind: "URBAN_FOCUS_CATALOGUE",
    sourceName: "Urban Focus",
    sourceUrl: product.url,
    sourceType: "INTERNAL",
    productId: null,
    name: product.name,
    brand: product.brand,
    model: product.manufacturerPartNumber,
    sku: product.sku,
    mpn: product.manufacturerPartNumber,
    specifications: [product.specifications, product.description, product.name].filter(Boolean).join("\n"),
    costExVatCents: product.costExVatCents,
    listedPriceCents: listed > 0 ? listed : null,
    vatIncluded: true,
    shippingCents: 0,
    procurementCents: 0,
    importCents: 0,
    riskPercent: 0,
    markupPercent: 0,
    stockQty: product.stockQuantity,
    stockKnown: true,
    fresh: product.stockQuantity > 0,
    checkedAt,
    reputable: true,
    imageUrls: product.imageUrls,
  };
}
