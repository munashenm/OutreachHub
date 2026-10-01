import { parseMoneyToCents } from "./quote";
import { compareRequirement, type ProductRequirement, type SourceType } from "./sourcing";

export const SEARCH_PROVIDER_DEPENDENCY = "External search did not run. Set BRAVE_SEARCH_API_KEY, or GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX, or SERPAPI_API_KEY.";

const MANUFACTURERS = ["lenovo.com", "hp.com", "dell.com", "asus.com", "acer.com", "apple.com", "microsoft.com"];
const DISTRIBUTORS = ["frontosa.co.za", "rectron.co.za", "syntech.co.za", "tarsus.co.za", "esquire.co.za", "mustek.co.za", "axiz.com", "pcd.co.za"];
const RETAILERS = ["wootware.co.za", "evetech.co.za", "dreamware.co.za", "incredible.co.za", "takealot.com", "loot.co.za", "laptopdirect.co.za", "firstshop.co.za", "comx.co.za", "rebeltech.co.za", "hificorp.co.za", "dionwired.co.za"];
const BLOCKED = ["ebay.", "amazon.", "facebook.", "bidorbuy.co.za", "gumtree.", "olx.", "aliexpress.", "temu.", "wish.com", "junkmail.co.za"];

export type SearchHit = { url: string; title: string };
export type RankedPage = { url: string; title: string; sourceName: string; sourceType: SourceType };
export type ParsedListing = {
  name: string;
  brand: string;
  model: string;
  sku: string;
  mpn: string;
  specifications: string;
  listedPriceCents: number;
  vatIncluded: boolean;
  availability: string;
  stockQty: number | null;
  currency: string;
};

export function configuredSearchProvider(env: Record<string, string | undefined>) {
  if (env.BRAVE_SEARCH_API_KEY?.trim()) return "brave" as const;
  if (env.GOOGLE_SEARCH_API_KEY?.trim() && env.GOOGLE_SEARCH_CX?.trim()) return "google" as const;
  if (env.SERPAPI_API_KEY?.trim()) return "serpapi" as const;
  return null;
}

export function externalSearchQuery(requirement: ProductRequirement) {
  if (requirement.sku) return `${requirement.sku} South Africa price`;
  if (requirement.mpn) return `${requirement.mpn} South Africa price`;
  return [
    requirement.productType || requirement.formFactor,
    requirement.brandPreference,
    requirement.processor,
    requirement.ramGb ? `${requirement.ramGb}GB RAM` : "",
    requirement.storageGb ? `${requirement.storageGb}GB ${requirement.storageType || "SSD"}` : "",
    requirement.operatingSystem,
    requirement.screenInches ? `${requirement.screenInches} inch` : "",
    "South Africa",
  ].filter(Boolean).join(" ");
}

export function rankExternalUrls(hits: SearchHit[]): RankedPage[] {
  const ranked: Array<RankedPage & { rank: number }> = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    let url: URL;
    try {
      url = new URL(hit.url);
    } catch {
      continue;
    }
    if (url.protocol !== "https:") continue;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (BLOCKED.some((name) => host.includes(name))) continue;
    if (/\b(used|refurbished|pre-?owned)\b/i.test(hit.title)) continue;
    const sourceType = hostType(host);
    if (!sourceType) continue;
    const key = url.origin + url.pathname;
    if (seen.has(key)) continue;
    seen.add(key);
    ranked.push({
      url: url.href,
      title: hit.title,
      sourceName: host,
      sourceType,
      rank: sourceType === "MANUFACTURER" ? 0 : sourceType === "DISTRIBUTOR" ? 1 : 2,
    });
  }
  ranked.sort((left, right) => left.rank - right.rank);
  return ranked.map(({ rank: _rank, ...page }) => page);
}

export function parseProductPage(html: string, pageUrl: string): { listing: ParsedListing | null; reason: string } {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1] ?? "");
  const product = blocks.flatMap(readJsonLd).find((node) => node.type === "Product") ?? null;
  const name = clean(product?.name || metaContent(html, "og:title") || titleText(html));
  if (!name) return { listing: null, reason: "The page did not name a product." };
  if (/\b(used|refurbished|pre-?owned)\b/i.test(name)) return { listing: null, reason: "The listing is used or refurbished." };
  const offer = product?.offer ?? null;
  const priceText = offer?.price || metaContent(html, "product:price:amount") || visiblePrice(html);
  const listedPriceCents = zarToCents(priceText);
  if (listedPriceCents == null) return { listing: null, reason: "The page did not state a price." };
  const currency = (offer?.currency || metaContent(html, "product:price:currency") || "ZAR").toUpperCase();
  if (currency !== "ZAR") return { listing: null, reason: `The price currency is ${currency}.` };
  const vat = vatStatus(html, offer?.vatIncluded ?? null);
  if (vat == null) return { listing: null, reason: "The page did not state whether VAT is included." };
  const availability = offer?.availability || availabilityText(html);
  if (!availability) return { listing: null, reason: "The page did not state availability." };
  const stockQty = quantityFromAvailability(availability) ?? quantityFromText(html);
  const specifications = clean([product?.description, name].filter(Boolean).join("\n"));
  return {
    listing: {
      name,
      brand: clean(product?.brand || ""),
      model: clean(product?.model || name),
      sku: clean(product?.sku || ""),
      mpn: clean(product?.mpn || ""),
      specifications,
      listedPriceCents,
      vatIncluded: vat,
      availability,
      stockQty,
      currency,
    },
    reason: "",
  };
}

export function listingRejection(requirement: ProductRequirement, listing: ParsedListing, pageUrl: string) {
  if (/\b(used|refurbished|pre-?owned)\b/i.test(`${listing.name} ${pageUrl}`)) return "The listing is used or refurbished.";
  const grade = compareRequirement(requirement, {
    sourceKind: "EXTERNAL_SOURCE",
    sourceName: "",
    sourceUrl: pageUrl,
    sourceType: "RETAILER",
    productId: null,
    name: listing.name,
    brand: listing.brand,
    model: listing.model,
    sku: listing.sku,
    mpn: listing.mpn,
    specifications: listing.specifications,
    costExVatCents: null,
    listedPriceCents: listing.listedPriceCents,
    vatIncluded: listing.vatIncluded,
    shippingCents: 0,
    procurementCents: 0,
    importCents: 0,
    riskPercent: 0,
    markupPercent: 0,
    stockQty: listing.stockQty,
    stockKnown: listing.stockQty != null,
    fresh: true,
    checkedAt: new Date().toISOString(),
    reputable: true,
  });
  if (grade === "DOES_NOT_MEET" || grade === "PARTIAL") return `The product is ${grade.replaceAll("_", " ").toLowerCase()}.`;
  const quantity = Math.max(1, requirement.quantity ?? 1);
  if (listing.stockQty == null) return "Availability does not state a quantity.";
  if (listing.stockQty < quantity) return `Only ${listing.stockQty} are available.`;
  return "";
}

function hostType(host: string): SourceType | null {
  if (MANUFACTURERS.some((name) => host === name || host.endsWith(`.${name}`))) return "MANUFACTURER";
  if (DISTRIBUTORS.some((name) => host === name || host.endsWith(`.${name}`))) return "DISTRIBUTOR";
  if (RETAILERS.some((name) => host === name || host.endsWith(`.${name}`))) return "RETAILER";
  return null;
}

type LdOffer = { price: string; currency: string; availability: string; vatIncluded: boolean | null };
type LdProduct = { type: "Product"; name: string; brand: string; model: string; sku: string; mpn: string; description: string; offer: LdOffer | null };

function readJsonLd(text: string): LdProduct[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    return [];
  }
  const nodes = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed["@graph"]) ? parsed["@graph"] : [parsed];
  return nodes.filter(isRecord).filter((node) => typeName(node).includes("Product")).map(productFrom);
}

function productFrom(node: Record<string, unknown>): LdProduct {
  const brandNode = node.brand;
  const brand = typeof brandNode === "string" ? brandNode : isRecord(brandNode) && typeof brandNode.name === "string" ? brandNode.name : "";
  const offers = node.offers;
  const offerNode = Array.isArray(offers) ? offers.find(isRecord) : isRecord(offers) ? offers : null;
  return {
    type: "Product",
    name: typeof node.name === "string" ? node.name : "",
    brand,
    model: typeof node.model === "string" ? node.model : "",
    sku: typeof node.sku === "string" ? node.sku : "",
    mpn: typeof node.mpn === "string" ? node.mpn : "",
    description: typeof node.description === "string" ? node.description : "",
    offer: offerNode ? offerFrom(offerNode) : null,
  };
}

function offerFrom(node: Record<string, unknown>): LdOffer {
  const spec = isRecord(node.priceSpecification) ? node.priceSpecification : null;
  const vat = spec && typeof spec.valueAddedTaxIncluded === "boolean" ? spec.valueAddedTaxIncluded : null;
  const price = node.price ?? node.lowPrice;
  return {
    price: typeof price === "number" ? price.toFixed(2) : typeof price === "string" ? price : "",
    currency: typeof node.priceCurrency === "string" ? node.priceCurrency : "",
    availability: typeof node.availability === "string" ? node.availability.split("/").pop() ?? "" : "",
    vatIncluded: vat,
  };
}

function vatStatus(html: string, stated: boolean | null) {
  if (stated != null) return stated;
  const inclusive = /\b(?:incl(?:uding|\.)?|inc\.?)\s*vat\b|\bvat\s+incl(?:uded)?\b/i.test(html);
  const exclusive = /\b(?:excl(?:uding|\.)?|ex\.?)\s*vat\b|\bvat\s+excl(?:uded)?\b/i.test(html);
  if (inclusive === exclusive) return null;
  return inclusive;
}

function availabilityText(html: string) {
  const stock = html.match(/\b(\d+)\s+(?:in stock|available)\b/i);
  if (stock) return stock[0];
  if (/\bout of stock\b/i.test(html)) return "OutOfStock";
  if (/\bin stock\b/i.test(html)) return "InStock";
  return "";
}

function quantityFromAvailability(value: string) {
  const compact = value.replace(/\s/g, "");
  const count = value.match(/\b(\d+)\b/);
  if (count) return Number(count[1]);
  if (/outofstock/i.test(compact)) return 0;
  return null;
}

function quantityFromText(html: string) {
  const labelled = html.match(/\b(?:qty|quantity|stock)\s*[:#]?\s*(\d+)\b/i);
  if (labelled) return Number(labelled[1]);
  const leading = html.match(/\b(\d+)\s+(?:in stock|available)\b/i);
  return leading ? Number(leading[1]) : null;
}

function visiblePrice(html: string) {
  return html.match(/R\s?\d{1,3}(?:[ ,]\d{3})*(?:[.,]\d{2})?/i)?.[0] ?? "";
}

function metaContent(html: string, property: string) {
  const match = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"))
    ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`, "i"));
  return match?.[1] ?? "";
}

function titleText(html: string) {
  return html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? "";
}

function zarToCents(value: string) {
  const cleaned = value.replace(/r/gi, "").replace(/\s/g, "").replace(/,(?=\d{3}\b)/g, "");
  const normalized = cleaned.includes(".") ? cleaned.replace(/,/g, "") : cleaned.replace(",", ".");
  return parseMoneyToCents(normalized);
}

function clean(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function typeName(node: Record<string, unknown>) {
  const value = node["@type"];
  return Array.isArray(value) ? value.join(" ") : typeof value === "string" ? value : "";
}
