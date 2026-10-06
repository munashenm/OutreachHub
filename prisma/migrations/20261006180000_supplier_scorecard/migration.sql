CREATE TABLE "SupplierScorecard" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "grossMargin" INTEGER,
    "moq" INTEGER,
    "feedAvailability" INTEGER,
    "deliveryToSouthAfrica" INTEGER,
    "warrantyRma" INTEGER,
    "certifications" INTEGER,
    "resellerProtection" INTEGER,
    "productUniqueness" INTEGER,
    "localCompetition" INTEGER,
    "notes" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierScorecard_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupplierScorecard_supplierId_key" ON "SupplierScorecard"("supplierId");
CREATE INDEX "SupplierScorecard_workspaceId_idx" ON "SupplierScorecard"("workspaceId");

ALTER TABLE "SupplierScorecard" ADD CONSTRAINT "SupplierScorecard_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
