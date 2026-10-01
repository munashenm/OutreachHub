import {
  SEARCH_PROVIDER_DEPENDENCY,
  configuredSearchProvider,
  externalSearchQuery,
  listingRejection,
  parseProductPage,
  rankExternalUrls,
  type SearchHit,
} from "../lib/external-search";
import { getDb } from "../lib/db";
import { sourcingCacheKey, type ProductRequirement, type SourcingCandidate } from "../lib/sourcing";
import { assertPublicHttpsUrl } from "../lib/stock";

const PAGE_LIMIT = 4;

export async function sourceExternalForRequirements(workspaceId: string, requirements: ProductRequirement[]) {
  const provider = configuredSearchProvider(process.env);
  if (!provider) return { candidates: [] as SourcingCandidate[], dependency: SEARCH_PROVIDER_DEPENDENCY, note: SEARCH_PROVIDER_DEPENDENCY };
  const candidates: SourcingCandidate[] = [];
  const notes: string[] = [];
  for (const requirement of requirements) {
    const query = externalSearchQuery(requirement);
    let hits: SearchHit[] = [];
    try {
      hits = await searchWeb(provider, query);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      notes.push(/api_key|subscription-token|key=/i.test(message) ? "The search provider could not be reached." : message.slice(0, 180) || "The search provider could not be reached.");
      continue;
    }
    const pages = rankExternalUrls(hits).slice(0, PAGE_LIMIT);
    notes.push(`Query: ${query}`);
    notes.push(`Sources: ${pages.map((page) => page.sourceName).join(", ") || "none"}`);
    for (const page of pages) {
      try {
        const html = await readPage(page.url);
        const parsed = parseProductPage(html, page.url);
        if (!parsed.listing) {
          notes.push(`Rejected ${page.url}: ${parsed.reason}`);
          continue;
        }
        const reason = listingRejection(requirement, parsed.listing, page.url);
        if (reason) {
          notes.push(`Rejected ${parsed.listing.name}: ${reason}`);
          continue;
        }
        const checkedAt = new Date();
        const cacheKey = sourcingCacheKey(requirement);
        const existing = await getDb().externalSourceOffer.findFirst({
          where: { workspaceId, cacheKey, sourceUrl: page.url, checkedAt: { gte: new Date(checkedAt.getTime() - 24 * 60 * 60 * 1000) } },
        });
        const saved = existing ?? await getDb().externalSourceOffer.create({
          data: {
            workspaceId,
            cacheKey,
            sourceName: page.sourceName,
            sourceUrl: page.url,
            productName: parsed.listing.name,
            brand: parsed.listing.brand,
            model: parsed.listing.model,
            sku: parsed.listing.sku,
            mpn: parsed.listing.mpn,
            specifications: parsed.listing.specifications,
            listedPriceCents: parsed.listing.listedPriceCents,
            currency: "ZAR",
            vatIncluded: parsed.listing.vatIncluded,
            availability: parsed.listing.availability,
            checkedAt,
            confidence: "MEDIUM",
            sourceType: page.sourceType,
            stockQty: parsed.listing.stockQty,
          },
        });
        candidates.push({
          sourceKind: "EXTERNAL_SOURCE",
          sourceName: saved.sourceName,
          sourceUrl: saved.sourceUrl,
          sourceType: page.sourceType,
          productId: null,
          name: saved.productName,
          brand: saved.brand,
          model: saved.model,
          sku: saved.sku,
          mpn: saved.mpn,
          specifications: saved.specifications,
          costExVatCents: null,
          listedPriceCents: saved.listedPriceCents,
          vatIncluded: saved.vatIncluded,
          shippingCents: saved.shippingCents,
          procurementCents: 0,
          importCents: 0,
          riskPercent: 5,
          markupPercent: 25,
          stockQty: saved.stockQty,
          stockKnown: saved.stockQty != null,
          fresh: true,
          checkedAt: saved.checkedAt.toISOString(),
          reputable: true,
        });
        notes.push(`Accepted ${saved.productName} at ${saved.sourceUrl}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "The product page could not be read.";
        notes.push(`Rejected ${page.url}: ${message.slice(0, 180)}`);
      }
    }
  }
  const note = notes.join("\n").slice(0, 2000) || "External search returned no usable product.";
  return { candidates, dependency: candidates.length > 0 ? null : note, note };
}

async function searchWeb(provider: "brave" | "google" | "serpapi", query: string): Promise<SearchHit[]> {
  if (provider === "brave") {
    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10&country=ZA`, {
      headers: { accept: "application/json", "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY ?? "" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`The search provider returned ${response.status}.`);
    const payload = await response.json() as { web?: { results?: Array<{ url?: string; title?: string }> } };
    return (payload.web?.results ?? []).flatMap((hit) => hit.url ? [{ url: hit.url, title: hit.title ?? "" }] : []);
  }
  if (provider === "google") {
    const url = new URL("https://www.googleapis.com/customsearch/v1");
    url.searchParams.set("key", process.env.GOOGLE_SEARCH_API_KEY ?? "");
    url.searchParams.set("cx", process.env.GOOGLE_SEARCH_CX ?? "");
    url.searchParams.set("q", query);
    url.searchParams.set("num", "10");
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`The search provider returned ${response.status}.`);
    const payload = await response.json() as { items?: Array<{ link?: string; title?: string }> };
    return (payload.items ?? []).flatMap((hit) => hit.link ? [{ url: hit.link, title: hit.title ?? "" }] : []);
  }
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("gl", "za");
  url.searchParams.set("hl", "en");
  url.searchParams.set("api_key", process.env.SERPAPI_API_KEY ?? "");
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`The search provider returned ${response.status}.`);
  const payload = await response.json() as { organic_results?: Array<{ link?: string; title?: string }> };
  return (payload.organic_results ?? []).flatMap((hit) => hit.link ? [{ url: hit.link, title: hit.title ?? "" }] : []);
}

async function readPage(value: string) {
  const url = assertPublicHttpsUrl(value);
  const response = await fetch(url, { redirect: "manual", headers: { accept: "text/html" }, signal: AbortSignal.timeout(8000) });
  if (response.status >= 300 && response.status < 400) throw new Error("The product page redirected.");
  if (!response.ok) throw new Error(`The product page returned ${response.status}.`);
  const text = await response.text();
  if (text.length > 1_500_000) throw new Error("The product page is too large.");
  return text;
}
