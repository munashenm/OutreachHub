import { AppError } from "../../lib/errors";
import { assertPublicHttpsUrl } from "../../lib/stock";
import type { StoreCatalogProduct, StoreCredentials, StoreProvider } from "./types";

export function createUrbanFocusStore(credentials: StoreCredentials): StoreProvider {
  const base = assertPublicHttpsUrl(credentials.apiBaseUrl);
  const token = credentials.token;

  async function request(path: string, search: Record<string, string>, init?: RequestInit) {
    const url = new URL(path.replace(/^\//, ""), `${base.origin}${base.pathname.replace(/\/$/, "")}/`);
    for (const [key, value] of Object.entries(search)) url.searchParams.set(key, value);
    const response = await fetch(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    });
    if (response.status === 401 || response.status === 403) throw new AppError("The store rejected the API key.");
    if (response.status >= 300 && response.status < 400) throw new AppError("The store API address must not redirect.");
    return response;
  }

  async function send(path: string, method: string, body?: unknown) {
    const response = await request(path, {}, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) throw new AppError(`The store returned ${response.status}.`);
  }

  return {
    async testConnection() {
      const response = await request("health", {});
      if (!response.ok) throw new AppError(`The store connection test returned ${response.status}.`);
    },
    async findProductBySku(sku: string) {
      const response = await request("products", { sku });
      if (response.status === 404) return null;
      if (!response.ok) throw new AppError(`The store returned ${response.status}.`);
      const body = await response.json() as { sku?: string; product?: { sku?: string } } | { sku?: string }[] | null;
      if (Array.isArray(body)) {
        const found = body.find((item) => item?.sku);
        return found?.sku ? { sku: found.sku } : null;
      }
      const skuValue = body?.sku || body?.product?.sku;
      return skuValue ? { sku: skuValue } : null;
    },
    createProduct(product: StoreCatalogProduct) {
      return send("products", "POST", product);
    },
    updatePrice(sku: string, unitPriceCents: number, currency: string) {
      return send(`products/${encodeURIComponent(sku)}/price`, "PATCH", { unitPriceCents, currency });
    },
    updateStock(sku: string, quantity: number) {
      return send(`products/${encodeURIComponent(sku)}/stock`, "PATCH", {
        quantity,
        stockStatus: quantity > 0 ? "in_stock" : "out_of_stock",
      });
    },
    updateContent(sku: string, content: { name: string; description: string; specifications: string }) {
      return send(`products/${encodeURIComponent(sku)}/content`, "PATCH", content);
    },
    updateImages(sku: string, imageUrls: string[]) {
      return send(`products/${encodeURIComponent(sku)}/images`, "PATCH", { imageUrls });
    },
    setPublished(sku: string, published: boolean) {
      return send(`products/${encodeURIComponent(sku)}/publication`, "PATCH", { published });
    },
    async listOrders(limit: number) {
      const response = await request("orders", { limit: String(limit) });
      if (!response.ok) throw new AppError(`The store returned ${response.status}.`);
      return response.json() as Promise<unknown>;
    },
  };
}
