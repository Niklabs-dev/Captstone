-- CreateTable
CREATE TABLE "cash_closing_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_method" "PaymentMethod" NOT NULL,
    "expected_amount" DECIMAL(12,2) NOT NULL,
    "counted_amount" DECIMAL(12,2) NOT NULL,
    "difference" DECIMAL(12,2) NOT NULL,
    "closing_id" UUID NOT NULL,

    CONSTRAINT "cash_closing_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cash_closing_lines_closing_id_payment_method_key" ON "cash_closing_lines"("closing_id", "payment_method");

-- AddForeignKey
ALTER TABLE "cash_closing_lines" ADD CONSTRAINT "cash_closing_lines_closing_id_fkey" FOREIGN KEY ("closing_id") REFERENCES "cash_closings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "cash_closings" DROP COLUMN "card_total",
DROP COLUMN "counted_cash",
DROP COLUMN "difference",
DROP COLUMN "system_cash";

-- AlterEnum
BEGIN;
CREATE TYPE "PaymentMethod_new" AS ENUM ('CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'TRANSFER');
ALTER TABLE "sales" ALTER COLUMN "payment_method" TYPE "PaymentMethod_new" USING ("payment_method"::text::"PaymentMethod_new");
ALTER TABLE "cash_closing_lines" ALTER COLUMN "payment_method" TYPE "PaymentMethod_new" USING ("payment_method"::text::"PaymentMethod_new");
ALTER TYPE "PaymentMethod" RENAME TO "PaymentMethod_old";
ALTER TYPE "PaymentMethod_new" RENAME TO "PaymentMethod";
DROP TYPE "public"."PaymentMethod_old";
COMMIT;
