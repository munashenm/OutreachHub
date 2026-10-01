ALTER TABLE "QuoteLine" ADD COLUMN "specifications" TEXT NOT NULL DEFAULT '';
ALTER TABLE "QuoteLine" ADD COLUMN "imageUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "QuoteLine" AS line
SET "specifications" = product."specifications",
    "imageUrls" = product."imageUrls"
FROM "Quote" AS quote, "Product" AS product
WHERE line."quoteId" = quote."id"
  AND line."productId" = product."id"
  AND quote."status" = 'SENT';
