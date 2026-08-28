-- CreateTable
CREATE TABLE "OAuthTransientState" (
    "stateHash" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "returnTo" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthTransientState_pkey" PRIMARY KEY ("stateHash")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateIndex
CREATE INDEX "OAuthTransientState_expiresAt_idx" ON "OAuthTransientState"("expiresAt");

-- CreateIndex
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");

-- CreateIndex
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");
