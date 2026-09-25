-- CreateEnum
CREATE TYPE "AccountSide" AS ENUM ('platform', 'clinic');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('methodist', 'sales_manager', 'sales_head', 'platform_admin', 'clinic_admin', 'vkk_lead', 'nurse', 'auditor', 'observer');

-- CreateEnum
CREATE TYPE "TwoFactorVia" AS ENUM ('sms', 'email');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('login_2fa', 'password_reset', 'enable_2fa');

-- CreateEnum
CREATE TYPE "SecondHandStatus" AS ENUM ('pending', 'confirmed', 'rejected', 'expired');

-- CreateEnum
CREATE TYPE "GrantEvent" AS ENUM ('grant', 'revoke');

-- CreateTable
CREATE TABLE "tenants" (
    "inn" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("inn")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "inn" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "org" TEXT,
    "fio" TEXT NOT NULL,
    "side" "AccountSide" NOT NULL,
    "role" "Role" NOT NULL,
    "pending" BOOLEAN NOT NULL DEFAULT false,
    "requestedRole" "Role",
    "branchName" TEXT,
    "passwordHash" TEXT NOT NULL,
    "twoFactor" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorVia" "TwoFactorVia" NOT NULL DEFAULT 'sms',
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "mustChange" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3),

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "via" "TwoFactorVia" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "actorId" TEXT,
    "actorRole" "Role",
    "tenantInn" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "meta" JSONB,
    "allowed" BOOLEAN NOT NULL,
    "prevHash" TEXT,
    "hash" TEXT NOT NULL,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "second_hand_requests" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "tenantInn" TEXT,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "SecondHandStatus" NOT NULL DEFAULT 'pending',
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "second_hand_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_grants" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "tenantInn" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "event" "GrantEvent" NOT NULL,
    "byAccountId" TEXT NOT NULL,
    "byRole" "Role" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "document_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_channels" (
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "lastOpId" TEXT,

    CONSTRAINT "platform_channels_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "tenant_channels" (
    "tenantInn" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "lastOpId" TEXT,

    CONSTRAINT "tenant_channels_pkey" PRIMARY KEY ("tenantInn","key")
);

-- CreateTable
CREATE TABLE "executor_marks" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "doneAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "executor_marks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounts_inn_phone_idx" ON "accounts"("inn", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_inn_login_key" ON "accounts"("inn", "login");

-- CreateIndex
CREATE INDEX "sessions_accountId_idx" ON "sessions"("accountId");

-- CreateIndex
CREATE INDEX "otp_codes_accountId_purpose_idx" ON "otp_codes"("accountId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "audit_log_seq_key" ON "audit_log"("seq");

-- CreateIndex
CREATE INDEX "audit_log_tenantInn_at_idx" ON "audit_log"("tenantInn", "at");

-- CreateIndex
CREATE INDEX "audit_log_actorId_at_idx" ON "audit_log"("actorId", "at");

-- CreateIndex
CREATE INDEX "second_hand_requests_status_type_idx" ON "second_hand_requests"("status", "type");

-- CreateIndex
CREATE INDEX "document_grants_tenantInn_code_seq_idx" ON "document_grants"("tenantInn", "code", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "executor_marks_accountId_itemKey_key" ON "executor_marks"("accountId", "itemKey");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenantInn_fkey" FOREIGN KEY ("tenantInn") REFERENCES "tenants"("inn") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_grants" ADD CONSTRAINT "document_grants_tenantInn_fkey" FOREIGN KEY ("tenantInn") REFERENCES "tenants"("inn") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_channels" ADD CONSTRAINT "tenant_channels_tenantInn_fkey" FOREIGN KEY ("tenantInn") REFERENCES "tenants"("inn") ON DELETE CASCADE ON UPDATE CASCADE;

