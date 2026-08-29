-- CreateTable
CREATE TABLE "BouquetAuthFlow" (
    "id" UUID NOT NULL,
    "stateHash" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "returnTo" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BouquetAuthFlow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BouquetProjectSession" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BouquetProjectSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BouquetAuthFlow_stateHash_key" ON "BouquetAuthFlow"("stateHash");

-- CreateIndex
CREATE INDEX "BouquetAuthFlow_expiresAt_idx" ON "BouquetAuthFlow"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "BouquetProjectSession_tokenHash_key" ON "BouquetProjectSession"("tokenHash");

-- CreateIndex
CREATE INDEX "BouquetProjectSession_userId_idx" ON "BouquetProjectSession"("userId");

-- CreateIndex
CREATE INDEX "BouquetProjectSession_expiresAt_idx" ON "BouquetProjectSession"("expiresAt");
