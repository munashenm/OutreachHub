CREATE TABLE "StoreOrderLine" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "productId" TEXT,
  "sku" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  CONSTRAINT "StoreOrderLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StoreOrderLine_workspaceId_idx" ON "StoreOrderLine"("workspaceId");
CREATE INDEX "StoreOrderLine_orderId_idx" ON "StoreOrderLine"("orderId");
CREATE INDEX "StoreOrderLine_productId_idx" ON "StoreOrderLine"("productId");

ALTER TABLE "StoreOrderLine" ADD CONSTRAINT "StoreOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "StoreOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreOrderLine" ADD CONSTRAINT "StoreOrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
