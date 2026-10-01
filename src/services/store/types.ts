export type StoreCatalogProduct = {
  sku: string;
  name: string;
  description: string;
  specifications: string;
  unitPriceCents: number;
  currency: string;
  stockQuantity: number;
  published: boolean;
  imageUrls: string[];
};

export type StoreCredentials = {
  apiBaseUrl: string;
  token: string;
};

export interface StoreProvider {
  testConnection(): Promise<void>;
  findProductBySku(sku: string): Promise<{ sku: string } | null>;
  createProduct(product: StoreCatalogProduct): Promise<void>;
  updatePrice(sku: string, unitPriceCents: number, currency: string): Promise<void>;
  updateStock(sku: string, quantity: number): Promise<void>;
  updateContent(sku: string, content: { name: string; description: string; specifications: string }): Promise<void>;
  updateImages(sku: string, imageUrls: string[]): Promise<void>;
  setPublished(sku: string, published: boolean): Promise<void>;
  listOrders(limit: number): Promise<unknown>;
  listCatalogue(page: number, perPage: number): Promise<unknown>;
  findByIdentity(query: { sku?: string; mpn?: string; barcode?: string }): Promise<{ sku: string } | null>;
}
