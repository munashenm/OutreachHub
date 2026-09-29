import { syncAllStockFeeds } from "@/services/stock-sync-service";
import { pullAllStoreOrders } from "@/services/store-order-service";

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || header !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const summary = await syncAllStockFeeds();
  const orders = await pullAllStoreOrders();
  return Response.json({ ...summary, orders });
}
