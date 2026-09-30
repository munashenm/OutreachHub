import { AppError } from "../../lib/errors";
import type { StoreCredentials, StoreProvider } from "./types";
import { createUrbanFocusStore } from "./urban-focus-store";

export function createStoreProvider(provider: string, credentials: StoreCredentials): StoreProvider {
  if (provider === "urban-focus") return createUrbanFocusStore(credentials);
  throw new AppError("This store provider is not available.");
}

export type { StoreCatalogProduct, StoreCredentials, StoreProvider } from "./types";
