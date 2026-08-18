-- CreateTable
CREATE TABLE "Role" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMPTZ(6),
    "updatedBy" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedBy" INTEGER,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" SERIAL NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "subject" VARCHAR(50) NOT NULL,
    "inverted" BOOLEAN NOT NULL DEFAULT false,
    "field" VARCHAR(50)[],
    "conditions" JSONB,
    "reason" VARCHAR(255),
    "roleId" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMPTZ(6),
    "updatedBy" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedBy" INTEGER,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password" TEXT NOT NULL,
    "roleId" INTEGER NOT NULL,
    "parentUserId" INTEGER,
    "nmid" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMPTZ(6),
    "updatedBy" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedBy" INTEGER,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminDetail" (
    "id" SERIAL NOT NULL,
    "fullname" VARCHAR(100) NOT NULL,
    "address" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(25) NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMPTZ(6),
    "updatedBy" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedBy" INTEGER,

    CONSTRAINT "AdminDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentDetail" (
    "id" SERIAL NOT NULL,
    "fullname" VARCHAR(100) NOT NULL,
    "address" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(25) NOT NULL,
    "bankCode" VARCHAR(10) NOT NULL,
    "bankName" VARCHAR(100) NOT NULL,
    "accountNumber" VARCHAR(50) NOT NULL,
    "accountHolderName" VARCHAR(100) NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMPTZ(6),
    "updatedBy" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedBy" INTEGER,

    CONSTRAINT "AgentDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantDetail" (
    "id" SERIAL NOT NULL,
    "ownerName" VARCHAR(100) NOT NULL,
    "businessName" VARCHAR(100) NOT NULL,
    "brandName" VARCHAR(100) NOT NULL,
    "phoneNumber" VARCHAR(30) NOT NULL,
    "nik" VARCHAR(30) NOT NULL,
    "ktpImage" TEXT,
    "npwp" VARCHAR(30) NOT NULL,
    "address" VARCHAR(255) NOT NULL,
    "province" VARCHAR(30) NOT NULL,
    "regency" VARCHAR(30) NOT NULL,
    "district" VARCHAR(30) NOT NULL,
    "village" VARCHAR(30) NOT NULL,
    "postalCode" VARCHAR(10) NOT NULL,
    "siupFile" TEXT,
    "coordinate" TEXT,
    "bankCode" VARCHAR(10) NOT NULL,
    "bankName" VARCHAR(100) NOT NULL,
    "accountNumber" VARCHAR(50) NOT NULL,
    "accountHolderName" VARCHAR(100) NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMPTZ(6),
    "updatedBy" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedBy" INTEGER,

    CONSTRAINT "MerchantDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantSignature" (
    "id" SERIAL NOT NULL,
    "clientId" TEXT NOT NULL,
    "secretKey" TEXT,
    "previousSecretKey" TEXT,
    "status" TEXT NOT NULL,
    "credentials" JSONB NOT NULL DEFAULT '{}',
    "payoutUrl" VARCHAR(512),
    "payinUrl" VARCHAR(512),
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMPTZ(6),
    "updatedBy" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedBy" INTEGER,

    CONSTRAINT "MerchantSignature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AdminDetail_userId_key" ON "AdminDetail"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentDetail_userId_key" ON "AgentDetail"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantDetail_userId_key" ON "MerchantDetail"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantSignature_clientId_key" ON "MerchantSignature"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantSignature_userId_key" ON "MerchantSignature"("userId");

-- AddForeignKey
ALTER TABLE "Permission" ADD CONSTRAINT "Permission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_parentUserId_fkey" FOREIGN KEY ("parentUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminDetail" ADD CONSTRAINT "AdminDetail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDetail" ADD CONSTRAINT "AgentDetail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantDetail" ADD CONSTRAINT "MerchantDetail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantSignature" ADD CONSTRAINT "MerchantSignature_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
