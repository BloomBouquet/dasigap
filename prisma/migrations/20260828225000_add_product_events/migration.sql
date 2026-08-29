-- CreateEnum
CREATE TYPE "ProductEventType" AS ENUM (
  'APP_VISITED',
  'ITEM_REGISTRATION_STARTED',
  'ITEM_REGISTRATION_COMPLETED',
  'RESALE_STARTED',
  'RESALE_COMPLETED',
  'RESALE_COPY_COPIED',
  'SALE_COMPLETED'
);

-- CreateTable
CREATE TABLE "ProductEvent" (
  "id" UUID NOT NULL,
  "userId" TEXT NOT NULL,
  "itemId" UUID,
  "type" "ProductEventType" NOT NULL,
  "durationMs" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProductEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductEvent_userId_createdAt_idx" ON "ProductEvent"("userId", "createdAt");
CREATE INDEX "ProductEvent_type_createdAt_idx" ON "ProductEvent"("type", "createdAt");
CREATE INDEX "ProductEvent_itemId_type_idx" ON "ProductEvent"("itemId", "type");
