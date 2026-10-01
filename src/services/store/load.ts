import { getDb } from "../../lib/db";
import { decryptSecret } from "../../lib/token-crypto";
import { createStoreProvider } from "./index";

export async function loadStoreProvider(workspaceId: string) {
  const workspace = await getDb().workspace.findFirst({
    where: { id: workspaceId },
    select: {
      id: true,
      storeName: true,
      storePublicUrl: true,
      storeBaseUrl: true,
      storeProvider: true,
      storeKeyEncrypted: true,
      minimumMarginPercent: true,
      storeLastSyncAt: true,
    },
  });
  if (!workspace?.storeName || !workspace.storePublicUrl || !workspace.storeBaseUrl || !workspace.storeKeyEncrypted) {
    return null;
  }
  return {
    workspace,
    provider: createStoreProvider(workspace.storeProvider, {
      apiBaseUrl: workspace.storeBaseUrl,
      token: decryptSecret(workspace.storeKeyEncrypted),
    }),
  };
}
