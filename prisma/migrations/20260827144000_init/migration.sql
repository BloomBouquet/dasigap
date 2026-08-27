-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('PURCHASED', 'RETURNABLE', 'OWNED', 'SELL_PREPARING', 'LISTED_EXTERNALLY', 'SOLD');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('KRW');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('RECEIPT', 'WARRANTY', 'OTHER');

-- CreateEnum
CREATE TYPE "WarrantySource" AS ENUM ('USER_INPUT');

-- CreateEnum
CREATE TYPE "MaintenanceType" AS ENUM ('REPAIR', 'REPLACEMENT', 'DAMAGE', 'CONDITION', 'NOTE');

-- CreateTable
CREATE TABLE "Item" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "brand" TEXT,
    "modelName" TEXT,
    "purchaseDate" DATE NOT NULL,
    "purchasePrice" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'KRW',
    "storeName" TEXT,
    "status" "ItemStatus" NOT NULL DEFAULT 'PURCHASED',
    "coverImageKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "type" "DocumentType" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarrantyRecord" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "startsAt" DATE NOT NULL,
    "endsAt" DATE,
    "source" "WarrantySource" NOT NULL DEFAULT 'USER_INPUT',
    "note" TEXT,

    CONSTRAINT "WarrantyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Component" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isPresent" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Component_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceRecord" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "type" "MaintenanceType" NOT NULL,
    "occurredAt" DATE NOT NULL,
    "note" TEXT,

    CONSTRAINT "MaintenanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResaleDraft" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "conditionGrade" TEXT NOT NULL,
    "defectNote" TEXT,
    "askingPrice" INTEGER,
    "generatedText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResaleDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleRecord" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "soldAt" DATE NOT NULL,
    "soldPrice" INTEGER NOT NULL,
    "channel" TEXT,

    CONSTRAINT "SaleRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Item_userId_idx" ON "Item"("userId");

-- CreateIndex
CREATE INDEX "Item_status_idx" ON "Item"("status");

-- CreateIndex
CREATE INDEX "Item_purchaseDate_idx" ON "Item"("purchaseDate");

-- CreateIndex
CREATE UNIQUE INDEX "ResaleDraft_itemId_key" ON "ResaleDraft"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "SaleRecord_itemId_key" ON "SaleRecord"("itemId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarrantyRecord" ADD CONSTRAINT "WarrantyRecord_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Component" ADD CONSTRAINT "Component_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResaleDraft" ADD CONSTRAINT "ResaleDraft_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleRecord" ADD CONSTRAINT "SaleRecord_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
