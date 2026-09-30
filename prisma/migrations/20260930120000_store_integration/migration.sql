ALTER TABLE "Workspace" ADD COLUMN "storeName" TEXT;
ALTER TABLE "Workspace" ADD COLUMN "storePublicUrl" TEXT;
ALTER TABLE "Workspace" ADD COLUMN "storeProvider" TEXT NOT NULL DEFAULT 'urban-focus';
ALTER TABLE "Workspace" ADD COLUMN "minimumMarginPercent" INTEGER NOT NULL DEFAULT 0;
