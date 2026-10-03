-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TipPoolStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'PAID');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'TRANSFER');

-- CreateEnum
CREATE TYPE "SaleChannel" AS ENUM ('IN_STORE', 'DELIVERY');

-- CreateEnum
CREATE TYPE "CashClosingStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "UnitOfMeasure" AS ENUM ('UNIT', 'KG', 'G', 'L', 'ML', 'PACK');

-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM ('PURCHASE', 'CONSUMPTION', 'WASTE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "InventoryCountStatus" AS ENUM ('OPEN', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "DataRightType" AS ENUM ('ACCESS', 'RECTIFICATION', 'CANCELLATION', 'OBJECTION', 'PORTABILITY');

-- CreateEnum
CREATE TYPE "DataRightStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'RESOLVED', 'REJECTED');

-- CreateTable
CREATE TABLE "stores" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "address" VARCHAR(200) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "description" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(160) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "first_name" VARCHAR(80) NOT NULL,
    "last_name" VARCHAR(80) NOT NULL,
    "rut" VARCHAR(12),
    "phone" VARCHAR(20),
    "hired_at" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "anonymized_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "role_id" UUID NOT NULL,
    "store_id" UUID,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "ip_address" INET,
    "user_agent" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID NOT NULL,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "action" VARCHAR(60) NOT NULL,
    "entity_type" VARCHAR(60) NOT NULL,
    "entity_id" VARCHAR(64),
    "detail" JSONB,
    "ip_address" INET,
    "user_agent" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID,
    "store_id" UUID,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(255),
    "requires_expiration" BOOLEAN NOT NULL DEFAULT false,
    "retention_years" INTEGER NOT NULL DEFAULT 5,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "document_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'ACTIVE',
    "issued_at" DATE,
    "expires_at" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "store_id" UUID NOT NULL,
    "subject_user_id" UUID,
    "document_type_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "current_version_id" UUID,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version_number" INTEGER NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_path" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256_hash" CHAR(64) NOT NULL,
    "change_note" VARCHAR(255),
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "document_id" UUID NOT NULL,
    "uploaded_by_id" UUID NOT NULL,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tip_pools" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "status" "TipPoolStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" VARCHAR(255),
    "confirmed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "store_id" UUID NOT NULL,
    "calculated_by_id" UUID NOT NULL,
    "confirmed_by_id" UUID,

    CONSTRAINT "tip_pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tip_pool_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "hours_worked" DECIMAL(6,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "pool_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "tip_pool_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sold_at" TIMESTAMPTZ(6) NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "channel" "SaleChannel" NOT NULL DEFAULT 'IN_STORE',
    "gross_amount" DECIMAL(12,2) NOT NULL,
    "tip_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "store_id" UUID NOT NULL,
    "cash_closing_id" UUID,
    "registered_by_id" UUID NOT NULL,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_closings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_date" DATE NOT NULL,
    "opening_cash" DECIMAL(12,2) NOT NULL,
    "system_cash" DECIMAL(12,2) NOT NULL,
    "counted_cash" DECIMAL(12,2),
    "difference" DECIMAL(12,2),
    "card_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "CashClosingStatus" NOT NULL DEFAULT 'OPEN',
    "notes" VARCHAR(255),
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "store_id" UUID NOT NULL,
    "responsible_id" UUID NOT NULL,

    CONSTRAINT "cash_closings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sku" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "category" VARCHAR(60),
    "unit" "UnitOfMeasure" NOT NULL,
    "min_stock" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" BIGSERIAL NOT NULL,
    "type" "InventoryMovementType" NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "reason" VARCHAR(255),
    "reference" VARCHAR(60),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "store_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_counts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "status" "InventoryCountStatus" NOT NULL DEFAULT 'OPEN',
    "counted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "store_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,

    CONSTRAINT "inventory_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "system_quantity" DECIMAL(12,3) NOT NULL,
    "counted_quantity" DECIMAL(12,3) NOT NULL,
    "difference" DECIMAL(12,3) NOT NULL,
    "count_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,

    CONSTRAINT "inventory_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_rights_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "DataRightType" NOT NULL,
    "status" "DataRightStatus" NOT NULL DEFAULT 'PENDING',
    "description" TEXT,
    "response" TEXT,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_at" DATE NOT NULL,
    "resolved_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "subject_id" UUID NOT NULL,
    "resolved_by_id" UUID,

    CONSTRAINT "data_rights_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_rut_key" ON "users"("rut");

-- CreateIndex
CREATE INDEX "users_store_id_idx" ON "users"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_store_id_created_at_idx" ON "audit_logs"("store_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_types_code_key" ON "document_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "documents_current_version_id_key" ON "documents"("current_version_id");

-- CreateIndex
CREATE INDEX "documents_store_id_status_idx" ON "documents"("store_id", "status");

-- CreateIndex
CREATE INDEX "documents_subject_user_id_idx" ON "documents"("subject_user_id");

-- CreateIndex
CREATE INDEX "documents_expires_at_idx" ON "documents"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_sha256_hash_key" ON "document_versions"("sha256_hash");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_document_id_version_number_key" ON "document_versions"("document_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "tip_pools_store_id_period_start_period_end_key" ON "tip_pools"("store_id", "period_start", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "tip_pool_lines_pool_id_user_id_key" ON "tip_pool_lines"("pool_id", "user_id");

-- CreateIndex
CREATE INDEX "sales_store_id_sold_at_idx" ON "sales"("store_id", "sold_at");

-- CreateIndex
CREATE INDEX "sales_cash_closing_id_idx" ON "sales"("cash_closing_id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_closings_store_id_business_date_key" ON "cash_closings"("store_id", "business_date");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE INDEX "inventory_movements_store_id_product_id_occurred_at_idx" ON "inventory_movements"("store_id", "product_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_count_lines_count_id_product_id_key" ON "inventory_count_lines"("count_id", "product_id");

-- CreateIndex
CREATE INDEX "data_rights_requests_status_due_at_idx" ON "data_rights_requests"("status", "due_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_subject_user_id_fkey" FOREIGN KEY ("subject_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "document_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tip_pools" ADD CONSTRAINT "tip_pools_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tip_pools" ADD CONSTRAINT "tip_pools_calculated_by_id_fkey" FOREIGN KEY ("calculated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tip_pools" ADD CONSTRAINT "tip_pools_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tip_pool_lines" ADD CONSTRAINT "tip_pool_lines_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "tip_pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tip_pool_lines" ADD CONSTRAINT "tip_pool_lines_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_cash_closing_id_fkey" FOREIGN KEY ("cash_closing_id") REFERENCES "cash_closings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_registered_by_id_fkey" FOREIGN KEY ("registered_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_closings" ADD CONSTRAINT "cash_closings_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_closings" ADD CONSTRAINT "cash_closings_responsible_id_fkey" FOREIGN KEY ("responsible_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_count_id_fkey" FOREIGN KEY ("count_id") REFERENCES "inventory_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_rights_requests" ADD CONSTRAINT "data_rights_requests_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_rights_requests" ADD CONSTRAINT "data_rights_requests_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
