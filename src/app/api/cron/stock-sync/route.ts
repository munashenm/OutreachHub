import { continueStorePushes, syncAllStockFeeds } from "@/services/stock-sync-service";
import { pullAllStoreOrders } from "@/services/store-order-service";
import { STOCK_PUSH_BUDGET_MS } from "@/lib/stock-drain";

export const maxDuration = 300;

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || header !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const deadlineAt = Date.now() + STOCK_PUSH_BUDGET_MS;
  const pushOnly = request.headers.get("x-stock-sync") === "push";
  const summary = pushOnly ? await continueStorePushes(deadlineAt) : await syncAllStockFeeds({ deadlineAt });
  const orders = pushOnly ? [] : await pullAllStoreOrders();
  return Response.json({ ...summary, orders });
}
