ALTER TABLE "ProductEvent" ADD COLUMN "dedupeKey" TEXT;

CREATE UNIQUE INDEX "ProductEvent_dedupeKey_key" ON "ProductEvent"("dedupeKey");
