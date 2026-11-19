-- =============================================================
-- Sistema de Gestión Interna Moi-food: esquema final de la base de datos
-- PostgreSQL 16. Generado el 19-11-2026.
--
-- Cómo se generó: se aplicaron en orden, sobre una base PostgreSQL 16
-- vacía y temporal, las 29 migraciones de
-- backend/prisma/migrations (20260924183514_init a
-- 20261111130000_inventario_bloqueo_finalizacion) y luego se ejecutó
--   pg_dump --schema-only --no-owner --no-privileges
-- Contiene la extensión btree_gist, 19 tipos enumerados, 41 tablas,
-- índices, restricciones (PK, FK, UNIQUE, CHECK, EXCLUDE), funciones y
-- 64 triggers. No incluye datos, usuarios ni credenciales.
-- La base de desarrollo local no se usó porque tenía aplicadas solo
-- 13 de las 29 migraciones.
-- =============================================================

--
-- PostgreSQL database dump
--


-- Dumped from database version 16.14
-- Dumped by pg_dump version 16.14

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: btree_gist; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;


--
-- Name: EXTENSION btree_gist; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION btree_gist IS 'support for indexing common datatypes in GiST';


--
-- Name: CashClosingStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."CashClosingStatus" AS ENUM (
    'OPEN',
    'CLOSED'
);


--
-- Name: CashClosingVoucherSource; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."CashClosingVoucherSource" AS ENUM (
    'MRCOMANDA',
    'MERCADO_PAGO'
);


--
-- Name: DataRightStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."DataRightStatus" AS ENUM (
    'PENDING',
    'IN_PROGRESS',
    'RESOLVED',
    'REJECTED'
);


--
-- Name: DataRightType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."DataRightType" AS ENUM (
    'ACCESS',
    'RECTIFICATION',
    'CANCELLATION',
    'OBJECTION',
    'PORTABILITY'
);


--
-- Name: DocumentStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."DocumentStatus" AS ENUM (
    'ACTIVE',
    'EXPIRED',
    'ARCHIVED'
);


--
-- Name: ExternalSystem; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ExternalSystem" AS ENUM (
    'MRCOMANDA'
);


--
-- Name: InventoryCountStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."InventoryCountStatus" AS ENUM (
    'OPEN',
    'CONFIRMED'
);


--
-- Name: InventoryMovementType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."InventoryMovementType" AS ENUM (
    'PURCHASE',
    'CONSUMPTION',
    'WASTE',
    'ADJUSTMENT'
);


--
-- Name: InventoryTemplateRowKind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."InventoryTemplateRowKind" AS ENUM (
    'ITEM',
    'BLANK',
    'SECTION'
);


--
-- Name: PaymentMethodBehavior; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."PaymentMethodBehavior" AS ENUM (
    'CASH',
    'RECONCILABLE_CARD',
    'EXTERNAL_OTHER'
);


--
-- Name: PayslipStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."PayslipStatus" AS ENUM (
    'PENDING_SIGNATURE',
    'PUBLISHED'
);


--
-- Name: SaleChannel; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SaleChannel" AS ENUM (
    'IN_STORE',
    'DELIVERY'
);


--
-- Name: SaleSource; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SaleSource" AS ENUM (
    'MANUAL',
    'MRCOMANDA'
);


--
-- Name: SalesImportResolution; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SalesImportResolution" AS ENUM (
    'AUTOMATIC',
    'MANUAL'
);


--
-- Name: SalesImportStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SalesImportStatus" AS ENUM (
    'PENDING',
    'ACTIVE',
    'SUPERSEDED'
);


--
-- Name: TipAgreementRule; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."TipAgreementRule" AS ENUM (
    'PROPORTIONAL_TO_HOURS',
    'EQUAL_SHARES'
);


--
-- Name: TipAllocationStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."TipAllocationStatus" AS ENUM (
    'UNPAID',
    'PAID'
);


--
-- Name: TipPoolStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."TipPoolStatus" AS ENUM (
    'DRAFT',
    'CONFIRMED',
    'PAID'
);


--
-- Name: UnitOfMeasure; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."UnitOfMeasure" AS ENUM (
    'UNIT',
    'KG',
    'L'
);


--
-- Name: audit_logs_prevent_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_logs_prevent_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'El registro de auditoría es inmutable: no se permite % sobre audit_logs', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;


--
-- Name: cash_closing_children_require_open(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cash_closing_children_require_open() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    IF EXISTS (SELECT 1 FROM "cash_closings" AS c WHERE c."status" = 'CLOSED') THEN
      RAISE EXCEPTION 'Hay cierres de caja cerrados: no se permite TRUNCATE sobre %', TG_TABLE_NAME
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NULL;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
    SELECT 1 FROM "cash_closings" AS c
    WHERE c."id" = OLD."closing_id" AND c."status" = 'CLOSED'
  ) THEN
    RAISE EXCEPTION 'El cierre de caja % está cerrado: no se permite % sobre %', OLD."closing_id", TG_OP, TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (
    SELECT 1 FROM "cash_closings" AS c
    WHERE c."id" = NEW."closing_id" AND c."status" = 'CLOSED'
  ) THEN
    RAISE EXCEPTION 'El cierre de caja % está cerrado: no se permite % sobre %', NEW."closing_id", TG_OP, TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: cash_closing_tip_entries_check_entry(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cash_closing_tip_entries_check_entry() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "cash_closings" AS c
    INNER JOIN "tip_entries" AS e ON e."id" = NEW."tip_entry_id"
    WHERE c."id" = NEW."closing_id"
      AND c."store_id" = e."store_id"
      AND c."business_date" = e."business_date"
  ) THEN
    RAISE EXCEPTION 'El registro de propinas debe ser del mismo local y día que el cierre de caja'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: cash_closings_enforce_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cash_closings_enforce_status() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  "voucher_mrcomanda" NUMERIC;
  "voucher_mp_gross" NUMERIC;
  "voucher_mp_tip" NUMERIC;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Los cierres de caja no se pueden eliminar: no se permite TRUNCATE sobre cash_closings'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'OPEN' THEN
      RAISE EXCEPTION 'El cierre de caja debe crearse en estado OPEN y cerrarse después'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'CLOSED' THEN
    RAISE EXCEPTION 'El cierre de caja % está cerrado y es inmutable: no se permite % sobre cash_closings', OLD."id", TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW."store_id" <> OLD."store_id"
    OR NEW."business_date" <> OLD."business_date"
    OR NEW."shift" <> OLD."shift" THEN
    RAISE EXCEPTION 'No se puede cambiar el local, el día ni el turno del cierre de caja %', OLD."id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW."status" = 'CLOSED' THEN
    SELECT
      COALESCE(SUM(v."amount") FILTER (WHERE v."source" = 'MRCOMANDA' AND (v."payment_method_id" IS NULL OR m."behavior" = 'RECONCILABLE_CARD')), 0),
      COALESCE(SUM(v."amount") FILTER (WHERE v."source" = 'MERCADO_PAGO'), 0),
      COALESCE(SUM(v."tip_included_amount"), 0)
    INTO "voucher_mrcomanda", "voucher_mp_gross", "voucher_mp_tip"
    FROM "cash_closing_vouchers" AS v
    LEFT JOIN "payment_methods" AS m ON m."id" = v."payment_method_id"
    WHERE v."closing_id" = NEW."id";

    IF "voucher_mrcomanda" <> NEW."mrcomanda_net_sales"
      OR "voucher_mp_gross" <> NEW."mercado_pago_gross_amount"
      OR "voucher_mp_tip" <> NEW."mercado_pago_tip_amount" THEN
      RAISE EXCEPTION 'Los totales de conciliación del cierre de caja % no coinciden con la suma de sus vouchers', NEW."id"
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW."difference_reason" IS NULL AND (
      NEW."reconciliation_difference" <> 0
      OR EXISTS (
        SELECT 1 FROM "cash_closing_lines" AS l
        WHERE l."closing_id" = NEW."id" AND l."difference" <> 0
      )
    ) THEN
      RAISE EXCEPTION 'El cierre de caja % tiene diferencias: el motivo es obligatorio para cerrarlo', NEW."id"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: daily_operation_participants_require_draft_pool(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.daily_operation_participants_require_draft_pool() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    IF EXISTS (
      SELECT 1
      FROM "tip_pool_daily_operation_sources" AS s
      INNER JOIN "tip_pools" AS p ON p."id" = s."pool_id"
      WHERE p."status" <> 'DRAFT'
    ) THEN
      RAISE EXCEPTION 'Hay repartos confirmados o pagados alimentados por operaciones diarias: no se permite TRUNCATE sobre %', TG_TABLE_NAME
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NULL;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
    SELECT 1
    FROM "tip_pool_daily_operation_sources" AS s
    INNER JOIN "tip_pools" AS p ON p."id" = s."pool_id"
    WHERE s."operation_id" = OLD."operation_id" AND p."status" <> 'DRAFT'
  ) THEN
    RAISE EXCEPTION 'La operación % alimenta un reparto confirmado o pagado: no se permite % sobre participantes', OLD."operation_id", TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (
    SELECT 1
    FROM "tip_pool_daily_operation_sources" AS s
    INNER JOIN "tip_pools" AS p ON p."id" = s."pool_id"
    WHERE s."operation_id" = NEW."operation_id" AND p."status" <> 'DRAFT'
  ) THEN
    RAISE EXCEPTION 'La operación % alimenta un reparto confirmado o pagado: no se permite % sobre participantes', NEW."operation_id", TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: daily_operation_participants_require_unpaid_tips(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.daily_operation_participants_require_unpaid_tips() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    IF EXISTS (SELECT 1 FROM "daily_tip_allocations" WHERE "status" = 'PAID') THEN
      RAISE EXCEPTION 'Hay propinas diarias pagadas: no se permite TRUNCATE sobre %', TG_TABLE_NAME
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NULL;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
    SELECT 1 FROM "daily_tip_allocations" AS a
    WHERE a."operation_id" = OLD."operation_id" AND a."status" = 'PAID'
  ) THEN
    RAISE EXCEPTION 'La operación % tiene propinas pagadas: no se permite % sobre participantes', OLD."operation_id", TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (
    SELECT 1 FROM "daily_tip_allocations" AS a
    WHERE a."operation_id" = NEW."operation_id" AND a."status" = 'PAID'
  ) THEN
    RAISE EXCEPTION 'La operación % tiene propinas pagadas: no se permite % sobre participantes', NEW."operation_id", TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: daily_operation_participants_validate_worker(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.daily_operation_participants_validate_worker() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "daily_operations" AS o
    INNER JOIN "users" AS u ON u."id" = NEW."worker_id"
    INNER JOIN "roles" AS r ON r."id" = u."role_id"
    WHERE o."id" = NEW."operation_id"
      AND u."store_id" = o."store_id"
      AND u."is_active" = true
      AND r."code" IN ('TRABAJADOR', 'SUPERVISOR')
  ) THEN
    RAISE EXCEPTION 'El participante % debe ser un trabajador activo del local de la operación % (rol TRABAJADOR o SUPERVISOR)', NEW."worker_id", NEW."operation_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: daily_operations_require_draft_pool(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.daily_operations_require_draft_pool() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (NEW."store_id" <> OLD."store_id"
      OR NEW."business_date" <> OLD."business_date"
      OR NEW."card_tip_amount" <> OLD."card_tip_amount"
      OR NEW."cash_tip_amount" <> OLD."cash_tip_amount"
      OR NEW."tip_fund_amount" <> OLD."tip_fund_amount")
     AND EXISTS (
       SELECT 1
       FROM "tip_pool_daily_operation_sources" AS s
       INNER JOIN "tip_pools" AS p ON p."id" = s."pool_id"
       WHERE s."operation_id" = OLD."id" AND p."status" <> 'DRAFT'
     ) THEN
    RAISE EXCEPTION 'La operación % alimenta un reparto confirmado o pagado: no se pueden corregir sus montos, fecha o local', OLD."id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: daily_operations_require_unpaid_tips(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.daily_operations_require_unpaid_tips() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (NEW."store_id" <> OLD."store_id"
      OR NEW."business_date" <> OLD."business_date"
      OR NEW."card_tip_amount" <> OLD."card_tip_amount"
      OR NEW."cash_tip_amount" <> OLD."cash_tip_amount"
      OR NEW."tip_fund_amount" <> OLD."tip_fund_amount")
     AND EXISTS (
       SELECT 1 FROM "daily_tip_allocations" AS a
       WHERE a."operation_id" = OLD."id" AND a."status" = 'PAID'
     ) THEN
    RAISE EXCEPTION 'La operación % tiene propinas pagadas: no se pueden corregir sus montos, fecha o local', OLD."id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: daily_tip_allocations_assert_balanced(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.daily_tip_allocations_assert_balanced() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_TABLE_NAME = 'daily_operations' THEN
    PERFORM "daily_tip_allocations_check_operation"(NEW."id");
    RETURN NULL;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM "daily_tip_allocations_check_operation"(OLD."operation_id");
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM "daily_tip_allocations_check_operation"(NEW."operation_id");
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: daily_tip_allocations_check_operation(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.daily_tip_allocations_check_operation(target uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  "fund" BIGINT;
  "allocated" BIGINT;
  "allocation_count" BIGINT;
  "participant_count" BIGINT;
  "mismatched" BIGINT;
BEGIN
  SELECT o."tip_fund_amount" INTO "fund"
  FROM "daily_operations" AS o WHERE o."id" = "target";
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*), COALESCE(sum(a."amount"), 0)
    INTO "allocation_count", "allocated"
    FROM "daily_tip_allocations" AS a
    WHERE a."operation_id" = "target";

  SELECT count(*) INTO "participant_count"
    FROM "daily_operation_participants" AS p
    WHERE p."operation_id" = "target";

  -- Sin reparto solo se acepta fondo 0 o una operación sin participantes
  -- (anterior a la selección de SPRINT-4R-T02: no hay entre quiénes
  -- repartir). Toda otra operación debe traer su reparto en la misma
  -- transacción.
  IF "allocation_count" = 0 THEN
    IF "fund" > 0 AND "participant_count" > 0 THEN
      RAISE EXCEPTION 'La operación % tiene fondo % y % participantes pero no tiene su reparto de propinas diarias: debe guardarse en la misma transacción', "target", "fund", "participant_count"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN;
  END IF;

  IF "allocated" <> "fund" THEN
    RAISE EXCEPTION 'Las propinas diarias de la operación % suman % y su fondo es %: deben ser iguales', "target", "allocated", "fund"
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO "mismatched"
  FROM (
    SELECT p."worker_id" FROM "daily_operation_participants" AS p
    WHERE p."operation_id" = "target"
  ) AS sel
  FULL JOIN (
    SELECT a."worker_id" FROM "daily_tip_allocations" AS a
    WHERE a."operation_id" = "target"
  ) AS alloc ON alloc."worker_id" = sel."worker_id"
  WHERE sel."worker_id" IS NULL OR alloc."worker_id" IS NULL;
  IF "mismatched" > 0 THEN
    RAISE EXCEPTION 'Las propinas diarias de la operación % no coinciden con sus participantes: debe haber una por participante', "target"
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;


--
-- Name: daily_tip_allocations_enforce(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.daily_tip_allocations_enforce() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    IF EXISTS (SELECT 1 FROM "daily_tip_allocations" WHERE "status" = 'PAID') THEN
      RAISE EXCEPTION 'Hay propinas diarias pagadas: no se permite TRUNCATE sobre daily_tip_allocations'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'PAID' THEN
      RAISE EXCEPTION 'La propina diaria % ya está pagada: no se puede eliminar', OLD."id"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" = 'PAID' THEN
      RAISE EXCEPTION 'La propina diaria % ya está pagada: es inmutable', OLD."id"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF (NEW."id", NEW."operation_id", NEW."worker_id", NEW."store_id",
        NEW."business_date", NEW."created_at")
      IS DISTINCT FROM
       (OLD."id", OLD."operation_id", OLD."worker_id", OLD."store_id",
        OLD."business_date", OLD."created_at") THEN
      RAISE EXCEPTION 'La propina diaria % no puede cambiar de operación, trabajador, local ni fecha', OLD."id"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW."status" = 'PAID' THEN
      IF NEW."amount" <> OLD."amount" THEN
        RAISE EXCEPTION 'La propina diaria % no puede cambiar su monto al pagarse', OLD."id"
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM "tip_payment_batches" AS b
        WHERE b."id" = NEW."payment_batch_id"
          AND b."store_id" = NEW."store_id"
          AND NEW."business_date" BETWEEN b."period_start" AND b."period_end"
      ) THEN
        RAISE EXCEPTION 'El lote de pago % no corresponde al local ni al período de la propina diaria %', NEW."payment_batch_id", OLD."id"
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- INSERT
  IF NEW."status" <> 'UNPAID' THEN
    RAISE EXCEPTION 'La propina diaria nace No pagada (UNPAID): el pago se registra después con un lote'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "daily_operations" AS o
    WHERE o."id" = NEW."operation_id"
      AND o."store_id" = NEW."store_id"
      AND o."business_date" = NEW."business_date"
  ) THEN
    RAISE EXCEPTION 'La propina diaria debe copiar el local y la fecha de negocio de la operación %', NEW."operation_id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "daily_operation_participants" AS p
    WHERE p."operation_id" = NEW."operation_id"
      AND p."worker_id" = NEW."worker_id"
  ) THEN
    RAISE EXCEPTION 'El trabajador % no participa de la operación %: no puede recibir propina de ese día', NEW."worker_id", NEW."operation_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: document_versions_prevent_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.document_versions_prevent_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1 FROM "documents" AS d
      WHERE d."id" = OLD."document_id"
        AND d."retain_until" < (now() AT TIME ZONE 'America/Santiago')::date
    ) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'No se puede eliminar una versión del documento % antes de su plazo de conservación', OLD."document_id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RAISE EXCEPTION 'Las versiones de documentos son inmutables: no se permite % sobre document_versions', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;


--
-- Name: documents_enforce_retention(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.documents_enforce_retention() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Los documentos deben conservarse durante su plazo de conservación: no se permite TRUNCATE sobre documents'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD."retain_until" >= (now() AT TIME ZONE 'America/Santiago')::date THEN
      RAISE EXCEPTION 'No se puede eliminar el documento % antes de su plazo de conservación (debe conservarse hasta el %)', OLD."id", OLD."retain_until"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW."retain_until" < OLD."retain_until" THEN
    RAISE EXCEPTION 'No se puede acortar el plazo de conservación del documento % (de % a %)', OLD."id", OLD."retain_until", NEW."retain_until"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: inventory_count_lines_require_open(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.inventory_count_lines_require_open() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  "target" UUID;
  "count_status" "InventoryCountStatus";
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    IF EXISTS (
      SELECT 1 FROM "inventory_count_lines" AS l
      JOIN "inventory_counts" AS c ON c."id" = l."count_id"
      WHERE c."status" = 'CONFIRMED'
    ) THEN
      RAISE EXCEPTION 'Hay líneas de tomas de inventario finalizadas: no se permite TRUNCATE sobre inventory_count_lines'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' AND (NEW."id", NEW."count_id", NEW."product_id")
    IS DISTINCT FROM (OLD."id", OLD."count_id", OLD."product_id") THEN
    RAISE EXCEPTION 'La línea % no puede cambiar de toma ni de producto', OLD."id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    "target" := OLD."count_id";
  ELSE
    "target" := NEW."count_id";
  END IF;

  -- Bloqueo de escritor sobre la toma (ver encabezado): serializa las
  -- escrituras de líneas de una toma entre sí y con su finalización.
  SELECT c."status" INTO "count_status"
    FROM "inventory_counts" AS c
    WHERE c."id" = "target"
    FOR NO KEY UPDATE;

  IF "count_status" = 'CONFIRMED' THEN
    RAISE EXCEPTION 'La toma de inventario % está finalizada: no se permite % sobre sus líneas', "target", TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  NEW."saved_at" := now();
  RETURN NEW;
END;
$$;


--
-- Name: inventory_counts_enforce_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.inventory_counts_enforce_status() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    IF EXISTS (SELECT 1 FROM "inventory_counts" WHERE "status" = 'CONFIRMED') THEN
      RAISE EXCEPTION 'Hay tomas de inventario finalizadas: no se permite TRUNCATE sobre inventory_counts'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'CONFIRMED' THEN
      RAISE EXCEPTION 'La toma de inventario % está finalizada: no se puede eliminar', OLD."id"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" = 'CONFIRMED' THEN
      RAISE EXCEPTION 'La toma de inventario % está finalizada: es inmutable', OLD."id"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF (NEW."id", NEW."store_id", NEW."created_by_id", NEW."created_at")
      IS DISTINCT FROM (OLD."id", OLD."store_id", OLD."created_by_id", OLD."created_at") THEN
      RAISE EXCEPTION 'La toma de inventario % no puede cambiar de local ni de creador', OLD."id"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  -- INSERT
  IF NEW."status" <> 'OPEN' THEN
    RAISE EXCEPTION 'La toma de inventario nace En curso (OPEN): se finaliza después'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: inventory_names_are_valid(character varying[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.inventory_names_are_valid(names character varying[]) RETURNS boolean
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    AS $$
  SELECT COALESCE(bool_and("name" IS NOT NULL AND btrim("name") <> ''), true)
  FROM unnest("names") AS "name"
$$;


--
-- Name: inventory_template_rows_enforce_fixed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.inventory_template_rows_enforce_fixed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Las filas de la plantilla de inventario son fijas: no se permite TRUNCATE sobre inventory_template_rows'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'La fila % de la plantilla de inventario es fija: no se puede eliminar', OLD."position"
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF (NEW."id", NEW."position", NEW."kind", NEW."created_at")
    IS DISTINCT FROM (OLD."id", OLD."position", OLD."kind", OLD."created_at") THEN
    RAISE EXCEPTION 'La fila % de la plantilla de inventario es fija: no puede cambiar de posición ni de tipo', OLD."position"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: normalize_external_label(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_external_label(label text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    AS $$
  SELECT btrim(
    regexp_replace(
      upper(
        translate(
          "label",
          'áàäâéèëêíìïîóòöôúùüûñÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑ',
          'aaaaeeeeiiiioooouuuunAAAAEEEEIIIIOOOOUUUUN'
        )
      ),
      '\s+',
      ' ',
      'g'
    )
  )
$$;


--
-- Name: payslip_documents_prevent_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.payslip_documents_prevent_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  "target_document_id" UUID;
BEGIN
  IF TG_TABLE_NAME = 'document_versions' THEN
    "target_document_id" := NEW."document_id";
  ELSE
    "target_document_id" := OLD."id";
  END IF;

  IF EXISTS (
    SELECT 1 FROM "payslips" AS p
    WHERE p."document_id" = "target_document_id"
      AND p."status" = 'PUBLISHED'
  ) THEN
    RAISE EXCEPTION 'El documento % es de una liquidación publicada: no se permite % sobre %', "target_document_id", TG_OP, TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: payslips_check_document(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.payslips_check_document() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "documents" AS d
    JOIN "document_types" AS t ON t."id" = d."document_type_id"
    WHERE d."id" = NEW."document_id"
      AND t."code" = 'LIQUIDACION'
      AND d."subject_user_id" = NEW."worker_id"
  ) THEN
    RAISE EXCEPTION 'La liquidación debe apuntar a un documento LIQUIDACION del mismo trabajador (documento %, trabajador %)', NEW."document_id", NEW."worker_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: payslips_enforce_publication(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.payslips_enforce_publication() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Las liquidaciones no se pueden eliminar: no se permite TRUNCATE sobre payslips'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' AND OLD."status" = 'PUBLISHED' AND EXISTS (
    SELECT 1 FROM "documents" AS d
    WHERE d."id" = OLD."document_id"
      AND d."retain_until" < (now() AT TIME ZONE 'America/Santiago')::date
  ) THEN
    RETURN OLD;
  END IF;

  IF OLD."status" = 'PUBLISHED' THEN
    RAISE EXCEPTION 'La liquidación publicada % es inmutable: no se permite % sobre payslips', OLD."id", TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW."worker_id" <> OLD."worker_id"
    OR NEW."period" <> OLD."period"
    OR NEW."document_id" <> OLD."document_id"
    OR NEW."created_by_id" <> OLD."created_by_id"
    OR NEW."created_at" <> OLD."created_at" THEN
    RAISE EXCEPTION 'No se puede cambiar el trabajador, el período, el documento ni la carga de la liquidación %', OLD."id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: sales_check_tip_entry(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_check_tip_entry() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW."tip_entry_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "tip_entries" AS e
    WHERE e."id" = NEW."tip_entry_id"
      AND e."store_id" = NEW."store_id"
      AND e."payment_method_id" = NEW."payment_method_id"
      AND e."business_date" = (NEW."sold_at" AT TIME ZONE 'America/Santiago')::date
  ) THEN
    RAISE EXCEPTION 'La venta y su registro de propinas deben coincidir en local, fecha y medio de pago'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: sales_import_lines_enforce(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_import_lines_enforce() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  "header_status" "SalesImportStatus";
  "header_system" "ExternalSystem";
  "header_resolved_by" UUID;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Las líneas de importación de ventas no se pueden eliminar: no se permite TRUNCATE sobre sales_import_lines'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT i."status" INTO "header_status"
      FROM "sales_imports" AS i
      WHERE i."id" = OLD."import_id"
      FOR SHARE;
    IF FOUND AND "header_status" <> 'PENDING' THEN
      RAISE EXCEPTION 'La importación de ventas % está en estado % y sus líneas son inmutables', OLD."import_id", "header_status"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
  END IF;

  SELECT i."status", i."system", i."resolved_by_id"
    INTO "header_status", "header_system", "header_resolved_by"
    FROM "sales_imports" AS i
    WHERE i."id" = NEW."import_id"
    FOR SHARE;
  IF NOT FOUND THEN
    -- La FK rechaza la fila con su propio error.
    RETURN NEW;
  END IF;
  IF "header_status" <> 'PENDING' THEN
    RAISE EXCEPTION 'La importación de ventas % está en estado % y sus líneas son inmutables', NEW."import_id", "header_status"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."resolution" = 'MANUAL' THEN
    IF "header_resolved_by" IS NULL THEN
      RAISE EXCEPTION 'La línea «%» se resolvió a mano, pero la importación no registra quién la resolvió', NEW."original_label"
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "payment_methods" AS m
      WHERE m."id" = NEW."payment_method_id" AND m."is_active"
    ) THEN
      RAISE EXCEPTION 'El medio de pago elegido a mano para «%» debe estar activo', NEW."original_label"
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "payment_method_aliases" AS a
      WHERE a."system" = "header_system"
        AND a."normalized_label" = NEW."normalized_label"
        AND a."payment_method_id" <> NEW."payment_method_id"
    ) THEN
      RAISE EXCEPTION 'La etiqueta «%» ya tiene un alias hacia otro medio de pago: no se puede elegir otro a mano', NEW."original_label"
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM "payment_method_aliases" AS a
    WHERE a."system" = "header_system"
      AND a."normalized_label" = NEW."normalized_label"
      AND a."payment_method_id" = NEW."payment_method_id"
  ) THEN
    RAISE EXCEPTION 'La etiqueta «%» no tiene un alias configurado hacia el medio de pago indicado', NEW."original_label"
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "sales_import_skipped_lines" AS k
    WHERE k."import_id" = NEW."import_id"
      AND (k."line_number" = NEW."line_number"
        OR k."normalized_label" = NEW."normalized_label")
  ) THEN
    RAISE EXCEPTION 'La línea «%» ya se omitió en esta importación', NEW."original_label"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: sales_import_skipped_lines_enforce(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_import_skipped_lines_enforce() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  "header_status" "SalesImportStatus";
  "header_system" "ExternalSystem";
  "header_resolved_by" UUID;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Las líneas omitidas de importación de ventas no se pueden eliminar: no se permite TRUNCATE sobre sales_import_skipped_lines'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Las líneas omitidas de la importación de ventas % son inmutables', OLD."import_id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT i."status" INTO "header_status"
      FROM "sales_imports" AS i
      WHERE i."id" = OLD."import_id"
      FOR SHARE;
    IF FOUND AND "header_status" <> 'PENDING' THEN
      RAISE EXCEPTION 'La importación de ventas % está en estado % y sus líneas omitidas son inmutables', OLD."import_id", "header_status"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;

  SELECT i."status", i."system", i."resolved_by_id"
    INTO "header_status", "header_system", "header_resolved_by"
    FROM "sales_imports" AS i
    WHERE i."id" = NEW."import_id"
    FOR SHARE;
  IF NOT FOUND THEN
    -- La FK rechaza la fila con su propio error.
    RETURN NEW;
  END IF;
  IF "header_status" <> 'PENDING' THEN
    RAISE EXCEPTION 'La importación de ventas % está en estado % y sus líneas omitidas son inmutables', NEW."import_id", "header_status"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."resolution" = 'MANUAL' AND "header_resolved_by" IS NULL THEN
    RAISE EXCEPTION 'Solo una importación resuelta a mano puede omitir a mano la línea «%»', NEW."original_label"
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "payment_method_aliases" AS a
    WHERE a."system" = "header_system"
      AND a."normalized_label" = NEW."normalized_label"
  ) THEN
    RAISE EXCEPTION 'La etiqueta «%» tiene un alias configurado: se asocia a su medio de pago y no se puede omitir', NEW."original_label"
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "sales_import_lines" AS l
    WHERE l."import_id" = NEW."import_id"
      AND (l."line_number" = NEW."line_number"
        OR l."normalized_label" = NEW."normalized_label")
  ) THEN
    RAISE EXCEPTION 'La línea «%» ya está asociada a un medio de pago en esta importación', NEW."original_label"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: sales_imports_enforce(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_imports_enforce() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  "line_count" BIGINT;
  "line_total" NUMERIC;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Las importaciones de ventas no se pueden eliminar: no se permite TRUNCATE sobre sales_imports'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'PENDING' THEN
      RAISE EXCEPTION 'La importación de ventas debe crearse en estado PENDING y confirmarse después'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."store_resolution" = 'MANUAL' THEN
      -- Local elegido a mano (SPRINT-4A-T18): activo y sin contradecir un ID
      -- Subway que ya identifica a otro local activo.
      IF NOT EXISTS (
        SELECT 1 FROM "stores" AS s
        WHERE s."id" = NEW."store_id" AND s."is_active"
      ) THEN
        RAISE EXCEPTION 'El local elegido a mano para la importación de ventas debe estar activo'
          USING ERRCODE = 'check_violation';
      END IF;
      IF NEW."subway_store_id" IS NOT NULL AND EXISTS (
        SELECT 1 FROM "stores" AS s
        WHERE s."subway_store_id" = NEW."subway_store_id"
          AND s."id" <> NEW."store_id"
          AND s."is_active"
      ) THEN
        RAISE EXCEPTION 'El ID Subway «%» ya identifica a otro local activo: no se puede elegir otro local a mano', NEW."subway_store_id"
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW."subway_store_id" IS NULL THEN
      RAISE EXCEPTION 'La importación de ventas debe indicar el ID Subway del local («%» no trae uno reconocible)', NEW."external_store_code"
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "stores" AS s
      WHERE s."id" = NEW."store_id"
        AND s."subway_store_id" = NEW."subway_store_id"
    ) THEN
      RAISE EXCEPTION 'El ID Subway «%» no está asignado al local de la importación', NEW."subway_store_id"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'PENDING' THEN
      RAISE EXCEPTION 'La importación de ventas % está en estado % y no se puede eliminar: solo se descartan importaciones PENDING', OLD."id", OLD."status"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE: los datos del archivo y su resolución son inmutables en
  -- cualquier estado.
  IF (NEW."id", NEW."system", NEW."store_id", NEW."business_date",
      NEW."period_start", NEW."period_end", NEW."external_store_code",
      NEW."external_store_name", NEW."version", NEW."total_amount",
      NEW."file_name", NEW."file_path", NEW."mime_type", NEW."size_bytes",
      NEW."sha256_hash", NEW."uploaded_by_id", NEW."created_at",
      NEW."issued_at", NEW."subway_store_id", NEW."store_resolution",
      NEW."resolved_by_id", NEW."resolved_at")
    IS DISTINCT FROM
     (OLD."id", OLD."system", OLD."store_id", OLD."business_date",
      OLD."period_start", OLD."period_end", OLD."external_store_code",
      OLD."external_store_name", OLD."version", OLD."total_amount",
      OLD."file_name", OLD."file_path", OLD."mime_type", OLD."size_bytes",
      OLD."sha256_hash", OLD."uploaded_by_id", OLD."created_at",
      OLD."issued_at", OLD."subway_store_id", OLD."store_resolution",
      OLD."resolved_by_id", OLD."resolved_at") THEN
    RAISE EXCEPTION 'Los datos del archivo de la importación de ventas % son inmutables', OLD."id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW."status" = OLD."status" THEN
    IF (NEW."is_current", NEW."confirmed_at", NEW."confirmed_by_id", NEW."superseded_at")
      IS DISTINCT FROM
       (OLD."is_current", OLD."confirmed_at", OLD."confirmed_by_id", OLD."superseded_at") THEN
      RAISE EXCEPTION 'La confirmación y el reemplazo de la importación de ventas % solo cambian junto con su estado', OLD."id"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'PENDING' AND NEW."status" = 'ACTIVE' THEN
    SELECT count(*), COALESCE(sum(l."amount"), 0)
      INTO "line_count", "line_total"
      FROM "sales_import_lines" AS l
      WHERE l."import_id" = NEW."id";
    IF "line_count" = 0 THEN
      RAISE EXCEPTION 'La importación de ventas % no tiene líneas por medio de pago: no se puede confirmar', NEW."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF "line_total" <> NEW."total_amount" THEN
      RAISE EXCEPTION 'La suma de las líneas (%) no coincide con el total del reporte (%) en la importación de ventas %', "line_total", NEW."total_amount", NEW."id"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'ACTIVE' AND NEW."status" = 'SUPERSEDED' THEN
    IF (NEW."confirmed_at", NEW."confirmed_by_id")
      IS DISTINCT FROM (OLD."confirmed_at", OLD."confirmed_by_id") THEN
      RAISE EXCEPTION 'No se puede cambiar la confirmación de la importación de ventas % al reemplazarla', OLD."id"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Transición de estado no permitida en la importación de ventas %: % → %', OLD."id", OLD."status", NEW."status"
    USING ERRCODE = 'insufficient_privilege';
END;
$$;


--
-- Name: sales_require_open_cash_closing(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_require_open_cash_closing() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  "closing_status" "CashClosingStatus";
  "closing_store_id" UUID;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    IF EXISTS (
      SELECT 1 FROM "sales" AS s
      INNER JOIN "cash_closings" AS c ON c."id" = s."cash_closing_id"
      WHERE c."status" = 'CLOSED'
    ) THEN
      RAISE EXCEPTION 'Hay ventas de cierres de caja cerrados: no se permite TRUNCATE sobre sales'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NULL;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD."cash_closing_id" IS NOT NULL AND EXISTS (
    SELECT 1 FROM "cash_closings" AS c
    WHERE c."id" = OLD."cash_closing_id" AND c."status" = 'CLOSED'
  ) THEN
    RAISE EXCEPTION 'La venta % pertenece al cierre de caja cerrado %: no se permite % sobre sales', OLD."id", OLD."cash_closing_id", TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW."cash_closing_id" IS NOT NULL THEN
    SELECT c."status", c."store_id" INTO "closing_status", "closing_store_id"
    FROM "cash_closings" AS c
    WHERE c."id" = NEW."cash_closing_id";

    IF FOUND THEN
      IF "closing_status" = 'CLOSED' THEN
        RAISE EXCEPTION 'El cierre de caja % está cerrado: no se permite asociarle ventas', NEW."cash_closing_id"
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF "closing_store_id" <> NEW."store_id" THEN
        RAISE EXCEPTION 'La venta y su cierre de caja deben ser del mismo local'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: tip_payment_batches_assert_totals(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tip_payment_batches_assert_totals() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_TABLE_NAME = 'tip_payment_batches' THEN
    PERFORM "tip_payment_batches_check_totals"(NEW."id");
    RETURN NULL;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD."payment_batch_id" IS NOT NULL THEN
    PERFORM "tip_payment_batches_check_totals"(OLD."payment_batch_id");
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW."payment_batch_id" IS NOT NULL THEN
    PERFORM "tip_payment_batches_check_totals"(NEW."payment_batch_id");
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: tip_payment_batches_check_totals(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tip_payment_batches_check_totals(target uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  "expected_total" BIGINT;
  "expected_count" INTEGER;
  "actual_total" BIGINT;
  "actual_count" BIGINT;
BEGIN
  SELECT b."total_amount", b."allocation_count"
    INTO "expected_total", "expected_count"
    FROM "tip_payment_batches" AS b WHERE b."id" = "target";
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT count(*), COALESCE(sum(a."amount"), 0)
    INTO "actual_count", "actual_total"
    FROM "daily_tip_allocations" AS a
    WHERE a."payment_batch_id" = "target";
  IF "actual_count" <> "expected_count" OR "actual_total" <> "expected_total" THEN
    RAISE EXCEPTION 'El lote de pago % declara % asignaciones por % y marcó % por %', "target", "expected_count", "expected_total", "actual_count", "actual_total"
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;


--
-- Name: tip_payment_batches_enforce_immutability(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tip_payment_batches_enforce_immutability() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'Los lotes de pago de propinas son inmutables: no se permite % sobre tip_payment_batches', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;


--
-- Name: tip_pool_children_hours_consistent(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tip_pool_children_hours_consistent() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  applied_rule text;
BEGIN
  SELECT COALESCE(p."agreement_snapshot"->>'rule', a."rule"::text)
  INTO applied_rule
  FROM "tip_pools" AS p
  LEFT JOIN "tip_agreements" AS a ON a."id" = p."agreement_id"
  WHERE p."id" = NEW."pool_id";

  IF applied_rule = 'EQUAL_SHARES' THEN
    IF NEW."hours_worked" IS NOT NULL THEN
      RAISE EXCEPTION 'El % del reparto equitativo % no lleva horas trabajadas: la regla reparte en partes iguales', TG_TABLE_NAME, NEW."pool_id"
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW."hours_worked" IS NULL THEN
      RAISE EXCEPTION 'El % del reparto % requiere horas trabajadas (regla %)', TG_TABLE_NAME, NEW."pool_id", COALESCE(applied_rule, 'desconocida')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: tip_pool_children_require_draft(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tip_pool_children_require_draft() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    IF EXISTS (SELECT 1 FROM "tip_pools" AS p WHERE p."status" <> 'DRAFT') THEN
      RAISE EXCEPTION 'Hay repartos confirmados o pagados: no se permite TRUNCATE sobre %', TG_TABLE_NAME
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NULL;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
    SELECT 1 FROM "tip_pools" AS p
    WHERE p."id" = OLD."pool_id" AND p."status" <> 'DRAFT'
  ) THEN
    RAISE EXCEPTION 'El reparto % ya no está en DRAFT: no se permite % sobre %', OLD."pool_id", TG_OP, TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (
    SELECT 1 FROM "tip_pools" AS p
    WHERE p."id" = NEW."pool_id" AND p."status" <> 'DRAFT'
  ) THEN
    RAISE EXCEPTION 'El reparto % ya no está en DRAFT: no se permite % sobre %', NEW."pool_id", TG_OP, TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: tip_pool_daily_operation_sources_enforce(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tip_pool_daily_operation_sources_enforce() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    IF EXISTS (SELECT 1 FROM "tip_pools" AS p WHERE p."status" <> 'DRAFT') THEN
      RAISE EXCEPTION 'Hay repartos confirmados o pagados: no se permite TRUNCATE sobre %', TG_TABLE_NAME
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NULL;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
    SELECT 1 FROM "tip_pools" AS p
    WHERE p."id" = OLD."pool_id" AND p."status" <> 'DRAFT'
  ) THEN
    RAISE EXCEPTION 'El reparto % ya no está en DRAFT: no se permite % sobre tip_pool_daily_operation_sources', OLD."pool_id", TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    IF EXISTS (
      SELECT 1 FROM "tip_pools" AS p
      WHERE p."id" = NEW."pool_id" AND p."status" <> 'DRAFT'
    ) THEN
      RAISE EXCEPTION 'El reparto % ya no está en DRAFT: no se permite % sobre tip_pool_daily_operation_sources', NEW."pool_id", TG_OP
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM "tip_pools" AS p
      INNER JOIN "daily_operations" AS o ON o."id" = NEW."operation_id"
      WHERE p."id" = NEW."pool_id"
        AND p."store_id" = o."store_id"
        AND NEW."amount" = o."tip_fund_amount"
    ) THEN
      RAISE EXCEPTION 'La fuente del reparto % no concilia: amount debe ser el tip_fund_amount de la operación % y ambas del mismo local', NEW."pool_id", NEW."operation_id"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: tip_pool_receipts_enforce_immutability(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tip_pool_receipts_enforce_immutability() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Las constancias de pago son inmutables: no se permite % sobre tip_pool_receipts', TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "tip_pools" AS p
    WHERE p."id" = NEW."pool_id" AND p."status" = 'PAID'
  ) THEN
    RAISE EXCEPTION 'Solo se emiten constancias de un reparto pagado (reparto %)', NEW."pool_id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "tip_pools" AS p
    INNER JOIN "tip_pool_lines" AS l ON l."pool_id" = p."id"
    WHERE p."id" = NEW."pool_id"
      AND l."user_id" = NEW."user_id"
      AND l."amount" = NEW."amount"
      AND l."hours_worked" IS NOT DISTINCT FROM NEW."hours_worked"
      AND p."store_id" = NEW."store_id"
      AND p."period_start" = NEW."period_start"
      AND p."period_end" = NEW."period_end"
      AND p."payment_date" = NEW."payment_date"
      AND p."paid_by_id" = NEW."paid_by_id"
  ) THEN
    RAISE EXCEPTION 'La constancia no coincide con el reparto % ni con la línea del trabajador %', NEW."pool_id", NEW."user_id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: tip_pool_sources_check_entry(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tip_pool_sources_check_entry() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "tip_pools" AS p
    INNER JOIN "tip_entries" AS e ON e."id" = NEW."tip_entry_id"
    WHERE p."id" = NEW."pool_id"
      AND p."store_id" = e."store_id"
      AND e."business_date" BETWEEN p."period_start" AND p."period_end"
  ) THEN
    RAISE EXCEPTION 'La fuente de propinas debe coincidir con el local y el período del reparto'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: tip_pools_enforce_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tip_pools_enforce_status() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Los repartos de propinas no se pueden eliminar: no se permite TRUNCATE sobre tip_pools'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'El reparto % está en estado % y no se puede eliminar', OLD."id", OLD."status"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."status" = 'PAID' THEN
    RAISE EXCEPTION 'El reparto pagado % es inmutable: no se permite UPDATE sobre tip_pools', OLD."id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD."status" = 'DRAFT' THEN
    IF NEW."status" = 'PAID' THEN
      RAISE EXCEPTION 'El reparto % debe confirmarse antes de marcarlo como pagado', OLD."id"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  -- OLD."status" = 'CONFIRMED'
  IF NEW."status" = 'DRAFT' THEN
    RAISE EXCEPTION 'El reparto confirmado % no puede volver a DRAFT', OLD."id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."total_amount" <> OLD."total_amount"
    OR NEW."store_id" <> OLD."store_id"
    OR NEW."period_start" <> OLD."period_start"
    OR NEW."period_end" <> OLD."period_end"
    OR NEW."agreement_id" IS DISTINCT FROM OLD."agreement_id"
    OR NEW."agreement_snapshot" IS DISTINCT FROM OLD."agreement_snapshot"
    OR NEW."calculated_by_id" <> OLD."calculated_by_id"
    OR NEW."calculated_at" <> OLD."calculated_at"
    OR NEW."confirmed_at" IS DISTINCT FROM OLD."confirmed_at"
    OR NEW."confirmed_by_id" IS DISTINCT FROM OLD."confirmed_by_id"
    OR NEW."notes" IS DISTINCT FROM OLD."notes"
    OR NEW."created_at" <> OLD."created_at" THEN
    RAISE EXCEPTION 'No se pueden cambiar los montos ni los datos del reparto confirmado %', OLD."id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."status" <> 'PAID' THEN
    RAISE EXCEPTION 'El reparto confirmado % solo puede pasar a PAID', OLD."id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'El pago del reparto % debe subir su versión en 1', OLD."id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id bigint NOT NULL,
    action character varying(60) NOT NULL,
    entity_type character varying(60) NOT NULL,
    entity_id character varying(64),
    detail jsonb,
    ip_address inet,
    user_agent character varying(255),
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    user_id uuid,
    store_id uuid
);


--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_logs_id_seq OWNED BY public.audit_logs.id;


--
-- Name: cash_closing_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_closing_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    expected_amount numeric(12,2) NOT NULL,
    counted_amount numeric(12,2) NOT NULL,
    difference numeric(12,2) NOT NULL,
    closing_id uuid NOT NULL,
    payment_method_id uuid NOT NULL,
    CONSTRAINT cash_closing_lines_amounts_nonnegative CHECK (((expected_amount >= (0)::numeric) AND (counted_amount >= (0)::numeric))),
    CONSTRAINT cash_closing_lines_difference_consistent CHECK ((difference = (counted_amount - expected_amount)))
);


--
-- Name: cash_closing_tip_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_closing_tip_entries (
    closing_id uuid NOT NULL,
    tip_entry_id uuid NOT NULL
);


--
-- Name: cash_closing_vouchers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_closing_vouchers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source public."CashClosingVoucherSource" NOT NULL,
    period_start timestamp(6) with time zone NOT NULL,
    period_end timestamp(6) with time zone NOT NULL,
    amount numeric(12,2) NOT NULL,
    tip_included_amount numeric(12,2) DEFAULT 0 NOT NULL,
    reference character varying(100),
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    closing_id uuid NOT NULL,
    payment_method_id uuid,
    CONSTRAINT cash_closing_vouchers_amounts_nonnegative CHECK (((amount >= (0)::numeric) AND (tip_included_amount >= (0)::numeric) AND (tip_included_amount <= amount))),
    CONSTRAINT cash_closing_vouchers_tip_only_mercado_pago CHECK (((source = 'MERCADO_PAGO'::public."CashClosingVoucherSource") OR (tip_included_amount = (0)::numeric))),
    CONSTRAINT cash_closing_vouchers_valid_period CHECK ((period_end > period_start))
);


--
-- Name: cash_closings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_closings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_date date NOT NULL,
    opening_cash numeric(12,2) NOT NULL,
    status public."CashClosingStatus" DEFAULT 'OPEN'::public."CashClosingStatus" NOT NULL,
    notes character varying(255),
    closed_at timestamp(6) with time zone,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone NOT NULL,
    store_id uuid NOT NULL,
    responsible_id uuid NOT NULL,
    closed_by_id uuid,
    difference_reason character varying(500),
    mercado_pago_gross_amount numeric(12,2) DEFAULT 0 NOT NULL,
    mercado_pago_tip_amount numeric(12,2) DEFAULT 0 NOT NULL,
    mrcomanda_net_sales numeric(12,2) DEFAULT 0 NOT NULL,
    reconciliation_difference numeric(12,2) DEFAULT 0 NOT NULL,
    shift smallint NOT NULL,
    CONSTRAINT cash_closings_difference_reason_not_blank CHECK (((difference_reason IS NULL) OR (btrim((difference_reason)::text) <> ''::text))),
    CONSTRAINT cash_closings_opening_cash_nonnegative CHECK ((opening_cash >= (0)::numeric)),
    CONSTRAINT cash_closings_reconciliation_amounts_nonnegative CHECK (((mrcomanda_net_sales >= (0)::numeric) AND (mercado_pago_gross_amount >= (0)::numeric) AND (mercado_pago_tip_amount >= (0)::numeric) AND (mercado_pago_tip_amount <= mercado_pago_gross_amount))),
    CONSTRAINT cash_closings_reconciliation_difference_consistent CHECK ((reconciliation_difference = ((mercado_pago_gross_amount - mercado_pago_tip_amount) - mrcomanda_net_sales))),
    CONSTRAINT cash_closings_shift_positive CHECK ((shift >= 1)),
    CONSTRAINT cash_closings_status_consistency CHECK ((((status = 'OPEN'::public."CashClosingStatus") AND (closed_at IS NULL) AND (closed_by_id IS NULL)) OR ((status = 'CLOSED'::public."CashClosingStatus") AND (closed_at IS NOT NULL) AND (closed_by_id IS NOT NULL))))
);


--
-- Name: daily_operation_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_operation_participants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    operation_id uuid NOT NULL,
    worker_id uuid NOT NULL
);


--
-- Name: daily_operation_vouchers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_operation_vouchers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    file_name character varying(255) NOT NULL,
    file_path character varying(500) NOT NULL,
    mime_type character varying(100) NOT NULL,
    size_bytes bigint NOT NULL,
    sha256_hash character(64) NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: daily_operations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_operations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_date date NOT NULL,
    card_tip_amount bigint NOT NULL,
    cash_tip_amount bigint NOT NULL,
    tip_fund_amount bigint NOT NULL,
    cash_difference bigint NOT NULL,
    difference_reason character varying(500),
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone NOT NULL,
    store_id uuid NOT NULL,
    responsible_id uuid NOT NULL,
    voucher_id uuid,
    CONSTRAINT daily_operations_card_tip_non_negative CHECK ((card_tip_amount >= 0)),
    CONSTRAINT daily_operations_cash_tip_non_negative CHECK ((cash_tip_amount >= 0)),
    CONSTRAINT daily_operations_difference_reason_required CHECK (((cash_difference = 0) OR ((difference_reason IS NOT NULL) AND (btrim((difference_reason)::text) <> ''::text)))),
    CONSTRAINT daily_operations_tip_fund_consistent CHECK ((tip_fund_amount = (card_tip_amount + cash_tip_amount))),
    CONSTRAINT daily_operations_voucher_required CHECK (((card_tip_amount = 0) OR (voucher_id IS NOT NULL)))
);


--
-- Name: daily_tip_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_tip_allocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_date date NOT NULL,
    amount bigint NOT NULL,
    status public."TipAllocationStatus" DEFAULT 'UNPAID'::public."TipAllocationStatus" NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone NOT NULL,
    operation_id uuid NOT NULL,
    store_id uuid NOT NULL,
    worker_id uuid NOT NULL,
    payment_batch_id uuid,
    CONSTRAINT daily_tip_allocations_amount_nonnegative CHECK ((amount >= 0)),
    CONSTRAINT daily_tip_allocations_paid_requires_batch CHECK ((((status = 'PAID'::public."TipAllocationStatus") AND (payment_batch_id IS NOT NULL)) OR ((status = 'UNPAID'::public."TipAllocationStatus") AND (payment_batch_id IS NULL))))
);


--
-- Name: data_rights_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.data_rights_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type public."DataRightType" NOT NULL,
    status public."DataRightStatus" DEFAULT 'PENDING'::public."DataRightStatus" NOT NULL,
    description text,
    response text,
    requested_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    due_at date NOT NULL,
    resolved_at timestamp(6) with time zone,
    updated_at timestamp(6) with time zone NOT NULL,
    subject_id uuid NOT NULL,
    resolved_by_id uuid
);


--
-- Name: document_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code character varying(40) NOT NULL,
    name character varying(100) NOT NULL,
    description character varying(255),
    requires_expiration boolean DEFAULT false NOT NULL,
    retention_years integer DEFAULT 5 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone NOT NULL,
    requires_dt_registration boolean DEFAULT false NOT NULL
);


--
-- Name: document_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version_number integer NOT NULL,
    file_name character varying(255) NOT NULL,
    file_path character varying(500) NOT NULL,
    mime_type character varying(100) NOT NULL,
    size_bytes bigint NOT NULL,
    sha256_hash character(64) NOT NULL,
    change_note character varying(255),
    uploaded_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    document_id uuid NOT NULL,
    uploaded_by_id uuid NOT NULL
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title character varying(160) NOT NULL,
    description text,
    status public."DocumentStatus" DEFAULT 'ACTIVE'::public."DocumentStatus" NOT NULL,
    issued_at date,
    expires_at date,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone NOT NULL,
    store_id uuid NOT NULL,
    subject_user_id uuid,
    document_type_id uuid NOT NULL,
    created_by_id uuid NOT NULL,
    current_version_id uuid,
    dt_registered_at timestamp(6) with time zone,
    dt_registered_by_id uuid,
    dt_registration_due_at date,
    retain_until date NOT NULL,
    CONSTRAINT documents_dt_registered_by_consistent CHECK (((dt_registered_at IS NULL) = (dt_registered_by_id IS NULL))),
    CONSTRAINT documents_dt_registered_requires_due_at CHECK (((dt_registered_at IS NULL) OR (dt_registration_due_at IS NOT NULL)))
);


--
-- Name: inventory_count_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_count_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    system_quantity numeric(12,3),
    counted_quantity numeric(12,3),
    difference numeric(12,3),
    count_id uuid NOT NULL,
    product_id uuid NOT NULL,
    box_content numeric(12,3),
    boxes integer,
    loose_only boolean DEFAULT false NOT NULL,
    loose_quantity numeric(12,3),
    package_content numeric(12,3),
    package_name character varying(30),
    packages integer,
    packages_per_box integer,
    product_name character varying(120) NOT NULL,
    product_sku character varying(40),
    saved_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    saved_by_id uuid NOT NULL,
    unit public."UnitOfMeasure" NOT NULL,
    CONSTRAINT inventory_count_lines_box_content_positive CHECK (((box_content IS NULL) OR (box_content > (0)::numeric))),
    CONSTRAINT inventory_count_lines_boxes_nonnegative CHECK (((boxes IS NULL) OR (boxes >= 0))),
    CONSTRAINT inventory_count_lines_boxes_require_content CHECK (((COALESCE(boxes, 0) = 0) OR (box_content IS NOT NULL))),
    CONSTRAINT inventory_count_lines_counted_quantity_consistent CHECK (((counted_quantity IS NULL) OR (counted_quantity = ((((COALESCE(boxes, 0))::numeric * COALESCE(box_content, (0)::numeric)) + ((COALESCE(packages, 0))::numeric * COALESCE(package_content, (0)::numeric))) + COALESCE(loose_quantity, (0)::numeric))))),
    CONSTRAINT inventory_count_lines_counted_state CHECK (((counted_quantity IS NULL) = ((boxes IS NULL) AND (packages IS NULL) AND (loose_quantity IS NULL)))),
    CONSTRAINT inventory_count_lines_loose_only CHECK (((NOT loose_only) OR ((COALESCE(boxes, 0) = 0) AND (COALESCE(packages, 0) = 0)))),
    CONSTRAINT inventory_count_lines_loose_quantity_nonnegative CHECK (((loose_quantity IS NULL) OR (loose_quantity >= (0)::numeric))),
    CONSTRAINT inventory_count_lines_package_content_positive CHECK (((package_content IS NULL) OR (package_content > (0)::numeric))),
    CONSTRAINT inventory_count_lines_packages_nonnegative CHECK (((packages IS NULL) OR (packages >= 0))),
    CONSTRAINT inventory_count_lines_packages_per_box_positive CHECK (((packages_per_box IS NULL) OR (packages_per_box >= 1))),
    CONSTRAINT inventory_count_lines_packages_require_content CHECK (((COALESCE(packages, 0) = 0) OR (package_content IS NOT NULL))),
    CONSTRAINT inventory_count_lines_snapshot_texts_not_blank CHECK (((btrim((product_name)::text) <> ''::text) AND ((product_sku IS NULL) OR (btrim((product_sku)::text) <> ''::text)) AND ((package_name IS NULL) OR (btrim((package_name)::text) <> ''::text)))),
    CONSTRAINT inventory_count_lines_unit_integer CHECK (((unit <> 'UNIT'::public."UnitOfMeasure") OR (((loose_quantity IS NULL) OR (loose_quantity = trunc(loose_quantity))) AND ((box_content IS NULL) OR (box_content = trunc(box_content))) AND ((package_content IS NULL) OR (package_content = trunc(package_content))))))
);


--
-- Name: inventory_counts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_counts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    status public."InventoryCountStatus" DEFAULT 'OPEN'::public."InventoryCountStatus" NOT NULL,
    counted_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    notes character varying(255),
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone NOT NULL,
    store_id uuid NOT NULL,
    created_by_id uuid NOT NULL,
    count_date date NOT NULL,
    finalized_at timestamp(6) with time zone,
    finalized_by_id uuid,
    template_snapshot jsonb,
    CONSTRAINT inventory_counts_status_consistency CHECK ((((status = 'OPEN'::public."InventoryCountStatus") AND (finalized_at IS NULL) AND (finalized_by_id IS NULL) AND (template_snapshot IS NULL)) OR ((status = 'CONFIRMED'::public."InventoryCountStatus") AND (finalized_at IS NOT NULL) AND (finalized_by_id IS NOT NULL) AND (template_snapshot IS NOT NULL))))
);


--
-- Name: inventory_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_movements (
    id bigint NOT NULL,
    type public."InventoryMovementType" NOT NULL,
    quantity numeric(12,3) NOT NULL,
    reason character varying(255),
    reference character varying(60),
    occurred_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    store_id uuid NOT NULL,
    product_id uuid NOT NULL,
    created_by_id uuid NOT NULL
);


--
-- Name: inventory_movements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inventory_movements_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inventory_movements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inventory_movements_id_seq OWNED BY public.inventory_movements.id;


--
-- Name: inventory_template_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_template_rows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "position" integer NOT NULL,
    kind public."InventoryTemplateRowKind" NOT NULL,
    printed_text character varying(120),
    section character varying(120) NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone NOT NULL,
    product_id uuid,
    CONSTRAINT inventory_template_rows_position_after_header CHECK (("position" >= 2)),
    CONSTRAINT inventory_template_rows_product_only_item CHECK (((product_id IS NULL) OR (kind = 'ITEM'::public."InventoryTemplateRowKind"))),
    CONSTRAINT inventory_template_rows_section_not_blank CHECK ((btrim((section)::text) <> ''::text)),
    CONSTRAINT inventory_template_rows_text_by_kind CHECK ((((kind = 'BLANK'::public."InventoryTemplateRowKind") AND (printed_text IS NULL)) OR ((kind <> 'BLANK'::public."InventoryTemplateRowKind") AND (printed_text IS NOT NULL) AND (btrim((printed_text)::text) <> ''::text))))
);


--
-- Name: payment_method_aliases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_method_aliases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    system public."ExternalSystem" NOT NULL,
    label character varying(100) NOT NULL,
    normalized_label character varying(100) NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone NOT NULL,
    payment_method_id uuid NOT NULL,
    CONSTRAINT payment_method_aliases_label_normalized CHECK (((normalized_label)::text = public.normalize_external_label((label)::text))),
    CONSTRAINT payment_method_aliases_label_not_blank CHECK ((btrim((label)::text) <> ''::text))
);


--
-- Name: payment_methods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_methods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code character varying(40) NOT NULL,
    name character varying(100) NOT NULL,
    sort_order integer NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    behavior public."PaymentMethodBehavior" NOT NULL,
    available_for_tips boolean DEFAULT false NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone NOT NULL
);


--
-- Name: payslips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payslips (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    period date NOT NULL,
    status public."PayslipStatus" DEFAULT 'PENDING_SIGNATURE'::public."PayslipStatus" NOT NULL,
    signed_at date,
    published_at timestamp(6) with time zone,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone NOT NULL,
    document_id uuid NOT NULL,
    worker_id uuid NOT NULL,
    created_by_id uuid NOT NULL,
    published_by_id uuid,
    CONSTRAINT payslips_period_first_day_check CHECK ((EXTRACT(day FROM period) = (1)::numeric)),
    CONSTRAINT payslips_status_publication_check CHECK ((((status = 'PENDING_SIGNATURE'::public."PayslipStatus") AND (signed_at IS NULL) AND (published_at IS NULL) AND (published_by_id IS NULL)) OR ((status = 'PUBLISHED'::public."PayslipStatus") AND (signed_at IS NOT NULL) AND (published_at IS NOT NULL) AND (published_by_id IS NOT NULL))))
);


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sku character varying(40),
    name character varying(120) NOT NULL,
    category character varying(60),
    unit public."UnitOfMeasure" NOT NULL,
    min_stock numeric(12,3) DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone NOT NULL,
    alternative_names character varying(120)[] DEFAULT (ARRAY[]::character varying[])::character varying(120)[] NOT NULL,
    box_content numeric(12,3),
    loose_only boolean DEFAULT false NOT NULL,
    package_content numeric(12,3),
    package_name character varying(30),
    packages_per_box integer,
    CONSTRAINT products_alternative_names_valid CHECK (public.inventory_names_are_valid(alternative_names)),
    CONSTRAINT products_box_content_positive CHECK (((box_content IS NULL) OR (box_content > (0)::numeric))),
    CONSTRAINT products_name_not_blank CHECK ((btrim((name)::text) <> ''::text)),
    CONSTRAINT products_package_content_positive CHECK (((package_content IS NULL) OR (package_content > (0)::numeric))),
    CONSTRAINT products_package_name_not_blank CHECK (((package_name IS NULL) OR (btrim((package_name)::text) <> ''::text))),
    CONSTRAINT products_packages_per_box_positive CHECK (((packages_per_box IS NULL) OR (packages_per_box >= 1))),
    CONSTRAINT products_sku_not_blank CHECK (((sku IS NULL) OR (btrim((sku)::text) <> ''::text))),
    CONSTRAINT products_unit_contents_integer CHECK (((unit <> 'UNIT'::public."UnitOfMeasure") OR (((box_content IS NULL) OR (box_content = trunc(box_content))) AND ((package_content IS NULL) OR (package_content = trunc(package_content))))))
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refresh_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token_hash character varying(255) NOT NULL,
    expires_at timestamp(6) with time zone NOT NULL,
    revoked_at timestamp(6) with time zone,
    ip_address inet,
    user_agent character varying(255),
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code character varying(30) NOT NULL,
    name character varying(50) NOT NULL,
    description character varying(255),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone NOT NULL
);


--
-- Name: sales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sold_at timestamp(6) with time zone NOT NULL,
    channel public."SaleChannel" DEFAULT 'IN_STORE'::public."SaleChannel" NOT NULL,
    gross_amount numeric(12,2) NOT NULL,
    tip_amount numeric(12,2) DEFAULT 0 NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    store_id uuid NOT NULL,
    cash_closing_id uuid,
    registered_by_id uuid NOT NULL,
    tip_entry_id uuid,
    payment_method_id uuid NOT NULL,
    period_end timestamp(6) with time zone,
    period_start timestamp(6) with time zone,
    source public."SaleSource" DEFAULT 'MANUAL'::public."SaleSource" NOT NULL,
    CONSTRAINT sales_mrcomanda_no_tip CHECK (((source <> 'MRCOMANDA'::public."SaleSource") OR (tip_amount = (0)::numeric))),
    CONSTRAINT sales_source_period_consistency CHECK ((((source = 'MRCOMANDA'::public."SaleSource") AND (period_start IS NOT NULL) AND (period_end IS NOT NULL)) OR ((source = 'MANUAL'::public."SaleSource") AND (period_start IS NULL) AND (period_end IS NULL)))),
    CONSTRAINT sales_valid_period CHECK (((period_end IS NULL) OR (period_end > period_start)))
);


--
-- Name: sales_import_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_import_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    line_number integer NOT NULL,
    original_label character varying(100) NOT NULL,
    normalized_label character varying(100) NOT NULL,
    amount bigint NOT NULL,
    percentage numeric(5,2),
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    import_id uuid NOT NULL,
    payment_method_id uuid NOT NULL,
    resolution public."SalesImportResolution" DEFAULT 'AUTOMATIC'::public."SalesImportResolution" NOT NULL,
    CONSTRAINT sales_import_lines_label_normalized CHECK (((normalized_label)::text = public.normalize_external_label((original_label)::text))),
    CONSTRAINT sales_import_lines_label_not_blank CHECK ((btrim((original_label)::text) <> ''::text)),
    CONSTRAINT sales_import_lines_line_number_positive CHECK ((line_number >= 1)),
    CONSTRAINT sales_import_lines_percentage_range CHECK (((percentage IS NULL) OR ((percentage >= (0)::numeric) AND (percentage <= (100)::numeric))))
);


--
-- Name: sales_import_skipped_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_import_skipped_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    line_number integer NOT NULL,
    original_label character varying(100) NOT NULL,
    normalized_label character varying(100) NOT NULL,
    amount bigint NOT NULL,
    percentage numeric(5,2),
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    import_id uuid NOT NULL,
    resolution public."SalesImportResolution" DEFAULT 'AUTOMATIC'::public."SalesImportResolution" NOT NULL,
    CONSTRAINT sales_import_skipped_lines_amount_zero CHECK ((amount = 0)),
    CONSTRAINT sales_import_skipped_lines_label_normalized CHECK (((normalized_label)::text = public.normalize_external_label((original_label)::text))),
    CONSTRAINT sales_import_skipped_lines_label_not_blank CHECK ((btrim((original_label)::text) <> ''::text)),
    CONSTRAINT sales_import_skipped_lines_line_number_positive CHECK ((line_number >= 1)),
    CONSTRAINT sales_import_skipped_lines_percentage_range CHECK (((percentage IS NULL) OR ((percentage >= (0)::numeric) AND (percentage <= (100)::numeric))))
);


--
-- Name: sales_imports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_imports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    system public."ExternalSystem" DEFAULT 'MRCOMANDA'::public."ExternalSystem" NOT NULL,
    business_date date NOT NULL,
    period_start timestamp(6) with time zone NOT NULL,
    period_end timestamp(6) with time zone NOT NULL,
    external_store_code character varying(100) NOT NULL,
    external_store_name character varying(150),
    version integer NOT NULL,
    status public."SalesImportStatus" DEFAULT 'PENDING'::public."SalesImportStatus" NOT NULL,
    is_current boolean,
    total_amount bigint NOT NULL,
    file_name character varying(255) NOT NULL,
    file_path character varying(500) NOT NULL,
    mime_type character varying(100) NOT NULL,
    size_bytes bigint NOT NULL,
    sha256_hash character(64) NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    confirmed_at timestamp(6) with time zone,
    superseded_at timestamp(6) with time zone,
    updated_at timestamp(6) with time zone NOT NULL,
    store_id uuid NOT NULL,
    uploaded_by_id uuid NOT NULL,
    confirmed_by_id uuid,
    issued_at timestamp(6) with time zone,
    subway_store_id character varying(10),
    resolved_at timestamp(6) with time zone,
    resolved_by_id uuid,
    store_resolution public."SalesImportResolution" DEFAULT 'AUTOMATIC'::public."SalesImportResolution" NOT NULL,
    CONSTRAINT sales_imports_business_date_matches_period CHECK ((business_date = ((period_start AT TIME ZONE 'America/Santiago'::text))::date)),
    CONSTRAINT sales_imports_external_code_normalized CHECK ((((external_store_code)::text = public.normalize_external_label((external_store_code)::text)) AND ((external_store_code)::text <> ''::text))),
    CONSTRAINT sales_imports_resolution_consistency CHECK ((((resolved_by_id IS NULL) = (resolved_at IS NULL)) AND ((store_resolution = 'AUTOMATIC'::public."SalesImportResolution") OR (resolved_by_id IS NOT NULL)))),
    CONSTRAINT sales_imports_sha256_format CHECK ((sha256_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT sales_imports_size_positive CHECK ((size_bytes > 0)),
    CONSTRAINT sales_imports_status_consistency CHECK ((((status = 'PENDING'::public."SalesImportStatus") AND (is_current IS NULL) AND (confirmed_at IS NULL) AND (confirmed_by_id IS NULL) AND (superseded_at IS NULL)) OR ((status = 'ACTIVE'::public."SalesImportStatus") AND (is_current = true) AND (confirmed_at IS NOT NULL) AND (confirmed_by_id IS NOT NULL) AND (superseded_at IS NULL)) OR ((status = 'SUPERSEDED'::public."SalesImportStatus") AND (is_current IS NULL) AND (confirmed_at IS NOT NULL) AND (confirmed_by_id IS NOT NULL) AND (superseded_at IS NOT NULL) AND (superseded_at >= confirmed_at)))),
    CONSTRAINT sales_imports_subway_store_id_digits CHECK (((subway_store_id)::text ~ '^[0-9]{1,10}$'::text)),
    CONSTRAINT sales_imports_valid_period CHECK (((period_end > period_start) AND ((period_end - period_start) <= '24:00:00'::interval))),
    CONSTRAINT sales_imports_version_positive CHECK ((version >= 1))
);


--
-- Name: store_closures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_closures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    closure_date date NOT NULL,
    reason character varying(300) NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    store_id uuid NOT NULL,
    created_by_id uuid NOT NULL,
    CONSTRAINT store_closures_reason_not_blank CHECK ((btrim((reason)::text) <> ''::text))
);


--
-- Name: store_external_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_external_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    system public."ExternalSystem" NOT NULL,
    external_code character varying(100) NOT NULL,
    external_name character varying(150),
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone NOT NULL,
    store_id uuid NOT NULL,
    CONSTRAINT store_external_codes_code_normalized CHECK ((((external_code)::text = public.normalize_external_label((external_code)::text)) AND ((external_code)::text <> ''::text)))
);


--
-- Name: store_operating_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_operating_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    opens_monday boolean NOT NULL,
    opens_tuesday boolean NOT NULL,
    opens_wednesday boolean NOT NULL,
    opens_thursday boolean NOT NULL,
    opens_friday boolean NOT NULL,
    opens_saturday boolean NOT NULL,
    opens_sunday boolean NOT NULL,
    tracking_start_date date NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone NOT NULL,
    store_id uuid NOT NULL,
    updated_by_id uuid NOT NULL,
    CONSTRAINT store_operating_schedules_opens_some_day CHECK ((opens_monday OR opens_tuesday OR opens_wednesday OR opens_thursday OR opens_friday OR opens_saturday OR opens_sunday))
);


--
-- Name: stores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    city character varying(100) NOT NULL,
    address character varying(200) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone NOT NULL,
    subway_store_id character varying(10),
    CONSTRAINT stores_subway_store_id_digits CHECK (((subway_store_id)::text ~ '^[0-9]{1,10}$'::text))
);


--
-- Name: tip_agreements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tip_agreements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(160) NOT NULL,
    rule public."TipAgreementRule" NOT NULL,
    valid_from date NOT NULL,
    valid_to date,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone NOT NULL,
    store_id uuid NOT NULL,
    created_by_id uuid NOT NULL,
    CONSTRAINT tip_agreements_valid_range CHECK (((valid_to IS NULL) OR (valid_to >= valid_from)))
);


--
-- Name: tip_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tip_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_date date NOT NULL,
    amount numeric(12,2) NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone NOT NULL,
    store_id uuid NOT NULL,
    responsible_id uuid NOT NULL,
    payment_method_id uuid NOT NULL,
    CONSTRAINT tip_entries_amount_nonnegative CHECK ((amount >= (0)::numeric))
);


--
-- Name: tip_payment_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tip_payment_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    total_amount bigint NOT NULL,
    allocation_count integer NOT NULL,
    paid_at timestamp(6) with time zone NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    store_id uuid NOT NULL,
    paid_by_id uuid NOT NULL,
    legacy_pool_id uuid,
    CONSTRAINT tip_payment_batches_count_positive CHECK ((allocation_count > 0)),
    CONSTRAINT tip_payment_batches_period_valid CHECK ((period_start <= period_end)),
    CONSTRAINT tip_payment_batches_total_nonnegative CHECK ((total_amount >= 0))
);


--
-- Name: tip_pool_daily_operation_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tip_pool_daily_operation_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    amount bigint NOT NULL,
    pool_id uuid NOT NULL,
    operation_id uuid NOT NULL,
    CONSTRAINT tip_pool_daily_operation_sources_amount_nonnegative CHECK ((amount >= 0))
);


--
-- Name: tip_pool_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tip_pool_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    hours_worked numeric(6,2),
    amount numeric(12,2) NOT NULL,
    pool_id uuid NOT NULL,
    user_id uuid NOT NULL,
    work_hours_record_id uuid
);


--
-- Name: tip_pool_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tip_pool_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    worker_name character varying(161) NOT NULL,
    store_name character varying(100) NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    hours_worked numeric(6,2),
    amount numeric(12,2) NOT NULL,
    payment_date date NOT NULL,
    paid_by_name character varying(161) NOT NULL,
    detail jsonb NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    pool_id uuid NOT NULL,
    user_id uuid NOT NULL,
    store_id uuid NOT NULL,
    paid_by_id uuid NOT NULL,
    CONSTRAINT tip_pool_receipts_amount_nonnegative CHECK ((amount >= (0)::numeric))
);


--
-- Name: tip_pool_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tip_pool_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    amount numeric(12,2) NOT NULL,
    pool_id uuid NOT NULL,
    tip_entry_id uuid NOT NULL,
    CONSTRAINT tip_pool_sources_amount_nonnegative CHECK ((amount >= (0)::numeric))
);


--
-- Name: tip_pools; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tip_pools (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    total_amount numeric(12,2) NOT NULL,
    status public."TipPoolStatus" DEFAULT 'DRAFT'::public."TipPoolStatus" NOT NULL,
    notes character varying(255),
    confirmed_at timestamp(6) with time zone,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone NOT NULL,
    store_id uuid NOT NULL,
    calculated_by_id uuid NOT NULL,
    confirmed_by_id uuid,
    agreement_id uuid,
    agreement_snapshot jsonb,
    paid_at timestamp(6) with time zone,
    paid_by_id uuid,
    payment_date date,
    version integer DEFAULT 1 NOT NULL,
    calculated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT tip_pools_status_consistency CHECK ((((status = 'DRAFT'::public."TipPoolStatus") AND (confirmed_at IS NULL) AND (confirmed_by_id IS NULL) AND (paid_at IS NULL) AND (paid_by_id IS NULL) AND (payment_date IS NULL)) OR ((status = 'CONFIRMED'::public."TipPoolStatus") AND (confirmed_at IS NOT NULL) AND (confirmed_by_id IS NOT NULL) AND (paid_at IS NULL) AND (paid_by_id IS NULL) AND (payment_date IS NULL)) OR ((status = 'PAID'::public."TipPoolStatus") AND (confirmed_at IS NOT NULL) AND (confirmed_by_id IS NOT NULL) AND (paid_at IS NOT NULL) AND (paid_by_id IS NOT NULL) AND (payment_date IS NOT NULL) AND (payment_date >= period_end)))),
    CONSTRAINT tip_pools_version_positive CHECK ((version >= 1))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(160) NOT NULL,
    password_hash character varying(255) NOT NULL,
    first_name character varying(80) NOT NULL,
    last_name character varying(80) NOT NULL,
    rut character varying(12),
    phone character varying(20),
    hired_at date,
    is_active boolean DEFAULT true NOT NULL,
    anonymized_at timestamp(6) with time zone,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone NOT NULL,
    role_id uuid NOT NULL,
    store_id uuid
);


--
-- Name: work_hours_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_hours_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    hours_worked numeric(6,2) NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone NOT NULL,
    store_id uuid NOT NULL,
    worker_id uuid NOT NULL,
    recorded_by_id uuid NOT NULL,
    CONSTRAINT work_hours_records_hours_nonnegative CHECK ((hours_worked >= (0)::numeric)),
    CONSTRAINT work_hours_records_valid_period CHECK ((period_end >= period_start))
);


--
-- Name: audit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs ALTER COLUMN id SET DEFAULT nextval('public.audit_logs_id_seq'::regclass);


--
-- Name: inventory_movements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements ALTER COLUMN id SET DEFAULT nextval('public.inventory_movements_id_seq'::regclass);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: cash_closing_lines cash_closing_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_closing_lines
    ADD CONSTRAINT cash_closing_lines_pkey PRIMARY KEY (id);


--
-- Name: cash_closing_tip_entries cash_closing_tip_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_closing_tip_entries
    ADD CONSTRAINT cash_closing_tip_entries_pkey PRIMARY KEY (closing_id, tip_entry_id);


--
-- Name: cash_closing_vouchers cash_closing_vouchers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_closing_vouchers
    ADD CONSTRAINT cash_closing_vouchers_pkey PRIMARY KEY (id);


--
-- Name: cash_closings cash_closings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_closings
    ADD CONSTRAINT cash_closings_pkey PRIMARY KEY (id);


--
-- Name: daily_operation_participants daily_operation_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_operation_participants
    ADD CONSTRAINT daily_operation_participants_pkey PRIMARY KEY (id);


--
-- Name: daily_operation_vouchers daily_operation_vouchers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_operation_vouchers
    ADD CONSTRAINT daily_operation_vouchers_pkey PRIMARY KEY (id);


--
-- Name: daily_operations daily_operations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_operations
    ADD CONSTRAINT daily_operations_pkey PRIMARY KEY (id);


--
-- Name: daily_tip_allocations daily_tip_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_tip_allocations
    ADD CONSTRAINT daily_tip_allocations_pkey PRIMARY KEY (id);


--
-- Name: data_rights_requests data_rights_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_rights_requests
    ADD CONSTRAINT data_rights_requests_pkey PRIMARY KEY (id);


--
-- Name: document_types document_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_types
    ADD CONSTRAINT document_types_pkey PRIMARY KEY (id);


--
-- Name: document_versions document_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_versions
    ADD CONSTRAINT document_versions_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: inventory_count_lines inventory_count_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_lines
    ADD CONSTRAINT inventory_count_lines_pkey PRIMARY KEY (id);


--
-- Name: inventory_counts inventory_counts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_counts
    ADD CONSTRAINT inventory_counts_pkey PRIMARY KEY (id);


--
-- Name: inventory_movements inventory_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_pkey PRIMARY KEY (id);


--
-- Name: inventory_template_rows inventory_template_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_template_rows
    ADD CONSTRAINT inventory_template_rows_pkey PRIMARY KEY (id);


--
-- Name: payment_method_aliases payment_method_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_method_aliases
    ADD CONSTRAINT payment_method_aliases_pkey PRIMARY KEY (id);


--
-- Name: payment_methods payment_methods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_methods
    ADD CONSTRAINT payment_methods_pkey PRIMARY KEY (id);


--
-- Name: payslips payslips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payslips
    ADD CONSTRAINT payslips_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: sales_import_lines sales_import_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_import_lines
    ADD CONSTRAINT sales_import_lines_pkey PRIMARY KEY (id);


--
-- Name: sales_import_skipped_lines sales_import_skipped_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_import_skipped_lines
    ADD CONSTRAINT sales_import_skipped_lines_pkey PRIMARY KEY (id);


--
-- Name: sales_imports sales_imports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_imports
    ADD CONSTRAINT sales_imports_pkey PRIMARY KEY (id);


--
-- Name: sales sales_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_pkey PRIMARY KEY (id);


--
-- Name: store_closures store_closures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_closures
    ADD CONSTRAINT store_closures_pkey PRIMARY KEY (id);


--
-- Name: store_external_codes store_external_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_external_codes
    ADD CONSTRAINT store_external_codes_pkey PRIMARY KEY (id);


--
-- Name: store_operating_schedules store_operating_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_operating_schedules
    ADD CONSTRAINT store_operating_schedules_pkey PRIMARY KEY (id);


--
-- Name: stores stores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stores
    ADD CONSTRAINT stores_pkey PRIMARY KEY (id);


--
-- Name: tip_agreements tip_agreements_no_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_agreements
    ADD CONSTRAINT tip_agreements_no_overlap EXCLUDE USING gist (store_id WITH =, daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[]'::text) WITH &&);


--
-- Name: tip_agreements tip_agreements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_agreements
    ADD CONSTRAINT tip_agreements_pkey PRIMARY KEY (id);


--
-- Name: tip_entries tip_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_entries
    ADD CONSTRAINT tip_entries_pkey PRIMARY KEY (id);


--
-- Name: tip_payment_batches tip_payment_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_payment_batches
    ADD CONSTRAINT tip_payment_batches_pkey PRIMARY KEY (id);


--
-- Name: tip_pool_daily_operation_sources tip_pool_daily_operation_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_pool_daily_operation_sources
    ADD CONSTRAINT tip_pool_daily_operation_sources_pkey PRIMARY KEY (id);


--
-- Name: tip_pool_lines tip_pool_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_pool_lines
    ADD CONSTRAINT tip_pool_lines_pkey PRIMARY KEY (id);


--
-- Name: tip_pool_receipts tip_pool_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_pool_receipts
    ADD CONSTRAINT tip_pool_receipts_pkey PRIMARY KEY (id);


--
-- Name: tip_pool_sources tip_pool_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_pool_sources
    ADD CONSTRAINT tip_pool_sources_pkey PRIMARY KEY (id);


--
-- Name: tip_pools tip_pools_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_pools
    ADD CONSTRAINT tip_pools_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: work_hours_records work_hours_records_no_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_hours_records
    ADD CONSTRAINT work_hours_records_no_overlap EXCLUDE USING gist (worker_id WITH =, daterange(period_start, period_end, '[]'::text) WITH &&);


--
-- Name: work_hours_records work_hours_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_hours_records
    ADD CONSTRAINT work_hours_records_pkey PRIMARY KEY (id);


--
-- Name: audit_logs_entity_type_entity_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_entity_type_entity_id_idx ON public.audit_logs USING btree (entity_type, entity_id);


--
-- Name: audit_logs_store_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_store_id_created_at_idx ON public.audit_logs USING btree (store_id, created_at);


--
-- Name: audit_logs_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_user_id_created_at_idx ON public.audit_logs USING btree (user_id, created_at);


--
-- Name: cash_closing_lines_closing_id_payment_method_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cash_closing_lines_closing_id_payment_method_id_key ON public.cash_closing_lines USING btree (closing_id, payment_method_id);


--
-- Name: cash_closing_tip_entries_tip_entry_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cash_closing_tip_entries_tip_entry_id_idx ON public.cash_closing_tip_entries USING btree (tip_entry_id);


--
-- Name: cash_closing_vouchers_closing_id_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cash_closing_vouchers_closing_id_source_idx ON public.cash_closing_vouchers USING btree (closing_id, source);


--
-- Name: cash_closings_closed_by_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cash_closings_closed_by_id_idx ON public.cash_closings USING btree (closed_by_id);


--
-- Name: cash_closings_store_id_business_date_shift_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cash_closings_store_id_business_date_shift_key ON public.cash_closings USING btree (store_id, business_date, shift);


--
-- Name: daily_operation_participants_operation_id_worker_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX daily_operation_participants_operation_id_worker_id_key ON public.daily_operation_participants USING btree (operation_id, worker_id);


--
-- Name: daily_operation_participants_worker_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX daily_operation_participants_worker_id_idx ON public.daily_operation_participants USING btree (worker_id);


--
-- Name: daily_operations_store_id_business_date_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX daily_operations_store_id_business_date_key ON public.daily_operations USING btree (store_id, business_date);


--
-- Name: daily_operations_voucher_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX daily_operations_voucher_id_key ON public.daily_operations USING btree (voucher_id);


--
-- Name: daily_tip_allocations_operation_id_worker_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX daily_tip_allocations_operation_id_worker_id_key ON public.daily_tip_allocations USING btree (operation_id, worker_id);


--
-- Name: daily_tip_allocations_payment_batch_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX daily_tip_allocations_payment_batch_id_idx ON public.daily_tip_allocations USING btree (payment_batch_id);


--
-- Name: daily_tip_allocations_store_id_business_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX daily_tip_allocations_store_id_business_date_idx ON public.daily_tip_allocations USING btree (store_id, business_date);


--
-- Name: daily_tip_allocations_worker_id_business_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX daily_tip_allocations_worker_id_business_date_idx ON public.daily_tip_allocations USING btree (worker_id, business_date);


--
-- Name: data_rights_requests_status_due_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX data_rights_requests_status_due_at_idx ON public.data_rights_requests USING btree (status, due_at);


--
-- Name: document_types_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX document_types_code_key ON public.document_types USING btree (code);


--
-- Name: document_versions_document_id_version_number_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX document_versions_document_id_version_number_key ON public.document_versions USING btree (document_id, version_number);


--
-- Name: document_versions_sha256_hash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX document_versions_sha256_hash_key ON public.document_versions USING btree (sha256_hash);


--
-- Name: documents_current_version_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX documents_current_version_id_key ON public.documents USING btree (current_version_id);


--
-- Name: documents_dt_registration_due_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_dt_registration_due_at_idx ON public.documents USING btree (dt_registration_due_at);


--
-- Name: documents_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_expires_at_idx ON public.documents USING btree (expires_at);


--
-- Name: documents_retain_until_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_retain_until_idx ON public.documents USING btree (retain_until);


--
-- Name: documents_store_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_store_id_status_idx ON public.documents USING btree (store_id, status);


--
-- Name: documents_subject_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_subject_user_id_idx ON public.documents USING btree (subject_user_id);


--
-- Name: inventory_count_lines_count_id_product_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inventory_count_lines_count_id_product_id_key ON public.inventory_count_lines USING btree (count_id, product_id);


--
-- Name: inventory_count_lines_product_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_count_lines_product_id_idx ON public.inventory_count_lines USING btree (product_id);


--
-- Name: inventory_count_lines_saved_by_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_count_lines_saved_by_id_idx ON public.inventory_count_lines USING btree (saved_by_id);


--
-- Name: inventory_counts_finalized_by_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_counts_finalized_by_id_idx ON public.inventory_counts USING btree (finalized_by_id);


--
-- Name: inventory_counts_store_id_count_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_counts_store_id_count_date_idx ON public.inventory_counts USING btree (store_id, count_date);


--
-- Name: inventory_counts_store_id_open_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inventory_counts_store_id_open_key ON public.inventory_counts USING btree (store_id) WHERE (status = 'OPEN'::public."InventoryCountStatus");


--
-- Name: inventory_movements_store_id_product_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_movements_store_id_product_id_occurred_at_idx ON public.inventory_movements USING btree (store_id, product_id, occurred_at);


--
-- Name: inventory_template_rows_position_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inventory_template_rows_position_key ON public.inventory_template_rows USING btree ("position");


--
-- Name: inventory_template_rows_product_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inventory_template_rows_product_id_key ON public.inventory_template_rows USING btree (product_id);


--
-- Name: payment_method_aliases_payment_method_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_method_aliases_payment_method_id_idx ON public.payment_method_aliases USING btree (payment_method_id);


--
-- Name: payment_method_aliases_system_normalized_label_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payment_method_aliases_system_normalized_label_key ON public.payment_method_aliases USING btree (system, normalized_label);


--
-- Name: payment_methods_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payment_methods_code_key ON public.payment_methods USING btree (code);


--
-- Name: payslips_document_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payslips_document_id_key ON public.payslips USING btree (document_id);


--
-- Name: payslips_status_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payslips_status_period_idx ON public.payslips USING btree (status, period);


--
-- Name: payslips_worker_id_period_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payslips_worker_id_period_key ON public.payslips USING btree (worker_id, period);


--
-- Name: products_sku_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX products_sku_key ON public.products USING btree (sku);


--
-- Name: refresh_tokens_token_hash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX refresh_tokens_token_hash_key ON public.refresh_tokens USING btree (token_hash);


--
-- Name: refresh_tokens_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX refresh_tokens_user_id_idx ON public.refresh_tokens USING btree (user_id);


--
-- Name: roles_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX roles_code_key ON public.roles USING btree (code);


--
-- Name: sales_cash_closing_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sales_cash_closing_id_idx ON public.sales USING btree (cash_closing_id);


--
-- Name: sales_import_lines_import_id_line_number_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sales_import_lines_import_id_line_number_key ON public.sales_import_lines USING btree (import_id, line_number);


--
-- Name: sales_import_lines_import_id_normalized_label_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sales_import_lines_import_id_normalized_label_key ON public.sales_import_lines USING btree (import_id, normalized_label);


--
-- Name: sales_import_lines_payment_method_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sales_import_lines_payment_method_id_idx ON public.sales_import_lines USING btree (payment_method_id);


--
-- Name: sales_import_skipped_lines_import_id_line_number_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sales_import_skipped_lines_import_id_line_number_key ON public.sales_import_skipped_lines USING btree (import_id, line_number);


--
-- Name: sales_import_skipped_lines_import_id_normalized_label_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sales_import_skipped_lines_import_id_normalized_label_key ON public.sales_import_skipped_lines USING btree (import_id, normalized_label);


--
-- Name: sales_imports_business_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sales_imports_business_date_idx ON public.sales_imports USING btree (business_date);


--
-- Name: sales_imports_store_id_business_date_is_current_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sales_imports_store_id_business_date_is_current_key ON public.sales_imports USING btree (store_id, business_date, is_current);


--
-- Name: sales_imports_store_id_business_date_sha256_hash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sales_imports_store_id_business_date_sha256_hash_key ON public.sales_imports USING btree (store_id, business_date, sha256_hash);


--
-- Name: sales_imports_store_id_business_date_version_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sales_imports_store_id_business_date_version_key ON public.sales_imports USING btree (store_id, business_date, version);


--
-- Name: sales_store_id_payment_method_id_period_start_period_end_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sales_store_id_payment_method_id_period_start_period_end_key ON public.sales USING btree (store_id, payment_method_id, period_start, period_end);


--
-- Name: sales_store_id_sold_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sales_store_id_sold_at_idx ON public.sales USING btree (store_id, sold_at);


--
-- Name: sales_tip_entry_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sales_tip_entry_id_idx ON public.sales USING btree (tip_entry_id);


--
-- Name: store_closures_store_id_closure_date_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX store_closures_store_id_closure_date_key ON public.store_closures USING btree (store_id, closure_date);


--
-- Name: store_external_codes_store_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX store_external_codes_store_id_idx ON public.store_external_codes USING btree (store_id);


--
-- Name: store_external_codes_system_external_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX store_external_codes_system_external_code_key ON public.store_external_codes USING btree (system, external_code);


--
-- Name: store_external_codes_system_store_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX store_external_codes_system_store_id_key ON public.store_external_codes USING btree (system, store_id);


--
-- Name: store_operating_schedules_store_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX store_operating_schedules_store_id_key ON public.store_operating_schedules USING btree (store_id);


--
-- Name: stores_name_normalized_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX stores_name_normalized_key ON public.stores USING btree (upper(translate(regexp_replace(btrim((name)::text), '\s+'::text, ' '::text, 'g'::text), 'ÁÉÍÓÚÜÑáéíóúüñ'::text, 'AEIOUUNaeiouun'::text)));


--
-- Name: stores_subway_store_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX stores_subway_store_id_key ON public.stores USING btree (subway_store_id);


--
-- Name: tip_agreements_store_id_valid_from_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tip_agreements_store_id_valid_from_key ON public.tip_agreements USING btree (store_id, valid_from);


--
-- Name: tip_agreements_store_id_valid_to_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tip_agreements_store_id_valid_to_idx ON public.tip_agreements USING btree (store_id, valid_to);


--
-- Name: tip_entries_store_id_business_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tip_entries_store_id_business_date_idx ON public.tip_entries USING btree (store_id, business_date);


--
-- Name: tip_entries_store_id_business_date_payment_method_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tip_entries_store_id_business_date_payment_method_id_key ON public.tip_entries USING btree (store_id, business_date, payment_method_id);


--
-- Name: tip_payment_batches_legacy_pool_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tip_payment_batches_legacy_pool_id_key ON public.tip_payment_batches USING btree (legacy_pool_id);


--
-- Name: tip_payment_batches_paid_by_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tip_payment_batches_paid_by_id_idx ON public.tip_payment_batches USING btree (paid_by_id);


--
-- Name: tip_payment_batches_store_id_period_start_period_end_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tip_payment_batches_store_id_period_start_period_end_idx ON public.tip_payment_batches USING btree (store_id, period_start, period_end);


--
-- Name: tip_pool_daily_operation_sources_operation_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tip_pool_daily_operation_sources_operation_id_key ON public.tip_pool_daily_operation_sources USING btree (operation_id);


--
-- Name: tip_pool_daily_operation_sources_pool_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tip_pool_daily_operation_sources_pool_id_idx ON public.tip_pool_daily_operation_sources USING btree (pool_id);


--
-- Name: tip_pool_lines_pool_id_user_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tip_pool_lines_pool_id_user_id_key ON public.tip_pool_lines USING btree (pool_id, user_id);


--
-- Name: tip_pool_lines_work_hours_record_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tip_pool_lines_work_hours_record_id_idx ON public.tip_pool_lines USING btree (work_hours_record_id);


--
-- Name: tip_pool_receipts_paid_by_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tip_pool_receipts_paid_by_id_idx ON public.tip_pool_receipts USING btree (paid_by_id);


--
-- Name: tip_pool_receipts_pool_id_user_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tip_pool_receipts_pool_id_user_id_key ON public.tip_pool_receipts USING btree (pool_id, user_id);


--
-- Name: tip_pool_receipts_store_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tip_pool_receipts_store_id_idx ON public.tip_pool_receipts USING btree (store_id);


--
-- Name: tip_pool_receipts_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tip_pool_receipts_user_id_idx ON public.tip_pool_receipts USING btree (user_id);


--
-- Name: tip_pool_sources_pool_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tip_pool_sources_pool_id_idx ON public.tip_pool_sources USING btree (pool_id);


--
-- Name: tip_pool_sources_tip_entry_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tip_pool_sources_tip_entry_id_key ON public.tip_pool_sources USING btree (tip_entry_id);


--
-- Name: tip_pools_agreement_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tip_pools_agreement_id_idx ON public.tip_pools USING btree (agreement_id);


--
-- Name: tip_pools_store_id_period_start_period_end_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tip_pools_store_id_period_start_period_end_key ON public.tip_pools USING btree (store_id, period_start, period_end);


--
-- Name: users_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);


--
-- Name: users_rut_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_rut_key ON public.users USING btree (rut);


--
-- Name: users_store_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_store_id_idx ON public.users USING btree (store_id);


--
-- Name: work_hours_records_store_id_period_start_period_end_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX work_hours_records_store_id_period_start_period_end_idx ON public.work_hours_records USING btree (store_id, period_start, period_end);


--
-- Name: work_hours_records_store_id_worker_id_period_start_period_e_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX work_hours_records_store_id_worker_id_period_start_period_e_key ON public.work_hours_records USING btree (store_id, worker_id, period_start, period_end);


--
-- Name: audit_logs audit_logs_immutable_rows; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_logs_immutable_rows BEFORE DELETE OR UPDATE ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.audit_logs_prevent_change();


--
-- Name: audit_logs audit_logs_immutable_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_logs_immutable_truncate BEFORE TRUNCATE ON public.audit_logs FOR EACH STATEMENT EXECUTE FUNCTION public.audit_logs_prevent_change();


--
-- Name: cash_closing_lines cash_closing_lines_require_open; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER cash_closing_lines_require_open BEFORE INSERT OR DELETE OR UPDATE ON public.cash_closing_lines FOR EACH ROW EXECUTE FUNCTION public.cash_closing_children_require_open();


--
-- Name: cash_closing_lines cash_closing_lines_require_open_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER cash_closing_lines_require_open_truncate BEFORE TRUNCATE ON public.cash_closing_lines FOR EACH STATEMENT EXECUTE FUNCTION public.cash_closing_children_require_open();


--
-- Name: cash_closing_tip_entries cash_closing_tip_entries_entry_consistency; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER cash_closing_tip_entries_entry_consistency BEFORE INSERT OR UPDATE ON public.cash_closing_tip_entries FOR EACH ROW EXECUTE FUNCTION public.cash_closing_tip_entries_check_entry();


--
-- Name: cash_closing_tip_entries cash_closing_tip_entries_require_open; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER cash_closing_tip_entries_require_open BEFORE INSERT OR DELETE OR UPDATE ON public.cash_closing_tip_entries FOR EACH ROW EXECUTE FUNCTION public.cash_closing_children_require_open();


--
-- Name: cash_closing_tip_entries cash_closing_tip_entries_require_open_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER cash_closing_tip_entries_require_open_truncate BEFORE TRUNCATE ON public.cash_closing_tip_entries FOR EACH STATEMENT EXECUTE FUNCTION public.cash_closing_children_require_open();


--
-- Name: cash_closing_vouchers cash_closing_vouchers_require_open; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER cash_closing_vouchers_require_open BEFORE INSERT OR DELETE OR UPDATE ON public.cash_closing_vouchers FOR EACH ROW EXECUTE FUNCTION public.cash_closing_children_require_open();


--
-- Name: cash_closing_vouchers cash_closing_vouchers_require_open_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER cash_closing_vouchers_require_open_truncate BEFORE TRUNCATE ON public.cash_closing_vouchers FOR EACH STATEMENT EXECUTE FUNCTION public.cash_closing_children_require_open();


--
-- Name: cash_closings cash_closings_status_rows; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER cash_closings_status_rows BEFORE INSERT OR DELETE OR UPDATE ON public.cash_closings FOR EACH ROW EXECUTE FUNCTION public.cash_closings_enforce_status();


--
-- Name: cash_closings cash_closings_status_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER cash_closings_status_truncate BEFORE TRUNCATE ON public.cash_closings FOR EACH STATEMENT EXECUTE FUNCTION public.cash_closings_enforce_status();


--
-- Name: daily_operation_participants daily_operation_participants_require_draft_pool_rows; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER daily_operation_participants_require_draft_pool_rows BEFORE INSERT OR DELETE OR UPDATE ON public.daily_operation_participants FOR EACH ROW EXECUTE FUNCTION public.daily_operation_participants_require_draft_pool();


--
-- Name: daily_operation_participants daily_operation_participants_require_draft_pool_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER daily_operation_participants_require_draft_pool_truncate BEFORE TRUNCATE ON public.daily_operation_participants FOR EACH STATEMENT EXECUTE FUNCTION public.daily_operation_participants_require_draft_pool();


--
-- Name: daily_operation_participants daily_operation_participants_require_unpaid_tips_rows; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER daily_operation_participants_require_unpaid_tips_rows BEFORE INSERT OR DELETE OR UPDATE ON public.daily_operation_participants FOR EACH ROW EXECUTE FUNCTION public.daily_operation_participants_require_unpaid_tips();


--
-- Name: daily_operation_participants daily_operation_participants_require_unpaid_tips_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER daily_operation_participants_require_unpaid_tips_truncate BEFORE TRUNCATE ON public.daily_operation_participants FOR EACH STATEMENT EXECUTE FUNCTION public.daily_operation_participants_require_unpaid_tips();


--
-- Name: daily_operation_participants daily_operation_participants_tip_allocations_balanced; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER daily_operation_participants_tip_allocations_balanced AFTER INSERT OR DELETE OR UPDATE ON public.daily_operation_participants DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.daily_tip_allocations_assert_balanced();


--
-- Name: daily_operation_participants daily_operation_participants_validate_worker_rows; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER daily_operation_participants_validate_worker_rows BEFORE INSERT OR UPDATE ON public.daily_operation_participants FOR EACH ROW EXECUTE FUNCTION public.daily_operation_participants_validate_worker();


--
-- Name: daily_operations daily_operations_require_draft_pool_rows; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER daily_operations_require_draft_pool_rows BEFORE UPDATE ON public.daily_operations FOR EACH ROW EXECUTE FUNCTION public.daily_operations_require_draft_pool();


--
-- Name: daily_operations daily_operations_require_unpaid_tips_rows; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER daily_operations_require_unpaid_tips_rows BEFORE UPDATE ON public.daily_operations FOR EACH ROW EXECUTE FUNCTION public.daily_operations_require_unpaid_tips();


--
-- Name: daily_operations daily_operations_tip_allocations_balanced; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER daily_operations_tip_allocations_balanced AFTER INSERT OR UPDATE ON public.daily_operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.daily_tip_allocations_assert_balanced();


--
-- Name: daily_tip_allocations daily_tip_allocations_balanced; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER daily_tip_allocations_balanced AFTER INSERT OR DELETE OR UPDATE ON public.daily_tip_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.daily_tip_allocations_assert_balanced();


--
-- Name: daily_tip_allocations daily_tip_allocations_batch_totals; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER daily_tip_allocations_batch_totals AFTER INSERT OR DELETE OR UPDATE ON public.daily_tip_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.tip_payment_batches_assert_totals();


--
-- Name: daily_tip_allocations daily_tip_allocations_enforce_rows; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER daily_tip_allocations_enforce_rows BEFORE INSERT OR DELETE OR UPDATE ON public.daily_tip_allocations FOR EACH ROW EXECUTE FUNCTION public.daily_tip_allocations_enforce();


--
-- Name: daily_tip_allocations daily_tip_allocations_enforce_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER daily_tip_allocations_enforce_truncate BEFORE TRUNCATE ON public.daily_tip_allocations FOR EACH STATEMENT EXECUTE FUNCTION public.daily_tip_allocations_enforce();


--
-- Name: document_versions document_versions_immutable_rows; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER document_versions_immutable_rows BEFORE DELETE OR UPDATE ON public.document_versions FOR EACH ROW EXECUTE FUNCTION public.document_versions_prevent_change();


--
-- Name: document_versions document_versions_immutable_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER document_versions_immutable_truncate BEFORE TRUNCATE ON public.document_versions FOR EACH STATEMENT EXECUTE FUNCTION public.document_versions_prevent_change();


--
-- Name: documents documents_retention_rows; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER documents_retention_rows BEFORE DELETE OR UPDATE OF retain_until ON public.documents FOR EACH ROW EXECUTE FUNCTION public.documents_enforce_retention();


--
-- Name: documents documents_retention_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER documents_retention_truncate BEFORE TRUNCATE ON public.documents FOR EACH STATEMENT EXECUTE FUNCTION public.documents_enforce_retention();


--
-- Name: inventory_count_lines inventory_count_lines_require_open_rows; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER inventory_count_lines_require_open_rows BEFORE INSERT OR DELETE OR UPDATE ON public.inventory_count_lines FOR EACH ROW EXECUTE FUNCTION public.inventory_count_lines_require_open();


--
-- Name: inventory_count_lines inventory_count_lines_require_open_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER inventory_count_lines_require_open_truncate BEFORE TRUNCATE ON public.inventory_count_lines FOR EACH STATEMENT EXECUTE FUNCTION public.inventory_count_lines_require_open();


--
-- Name: inventory_counts inventory_counts_status_rows; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER inventory_counts_status_rows BEFORE INSERT OR DELETE OR UPDATE ON public.inventory_counts FOR EACH ROW EXECUTE FUNCTION public.inventory_counts_enforce_status();


--
-- Name: inventory_counts inventory_counts_status_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER inventory_counts_status_truncate BEFORE TRUNCATE ON public.inventory_counts FOR EACH STATEMENT EXECUTE FUNCTION public.inventory_counts_enforce_status();


--
-- Name: inventory_template_rows inventory_template_rows_fixed_rows; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER inventory_template_rows_fixed_rows BEFORE DELETE OR UPDATE ON public.inventory_template_rows FOR EACH ROW EXECUTE FUNCTION public.inventory_template_rows_enforce_fixed();


--
-- Name: inventory_template_rows inventory_template_rows_fixed_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER inventory_template_rows_fixed_truncate BEFORE TRUNCATE ON public.inventory_template_rows FOR EACH STATEMENT EXECUTE FUNCTION public.inventory_template_rows_enforce_fixed();


--
-- Name: document_versions payslip_document_versions_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payslip_document_versions_insert BEFORE INSERT ON public.document_versions FOR EACH ROW EXECUTE FUNCTION public.payslip_documents_prevent_change();


--
-- Name: documents payslip_documents_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payslip_documents_update BEFORE UPDATE OF title, description, issued_at, store_id, subject_user_id, document_type_id, current_version_id ON public.documents FOR EACH ROW EXECUTE FUNCTION public.payslip_documents_prevent_change();


--
-- Name: payslips payslips_check_document_rows; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payslips_check_document_rows BEFORE INSERT OR UPDATE OF document_id, worker_id ON public.payslips FOR EACH ROW EXECUTE FUNCTION public.payslips_check_document();


--
-- Name: payslips payslips_publication_rows; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payslips_publication_rows BEFORE DELETE OR UPDATE ON public.payslips FOR EACH ROW EXECUTE FUNCTION public.payslips_enforce_publication();


--
-- Name: payslips payslips_publication_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payslips_publication_truncate BEFORE TRUNCATE ON public.payslips FOR EACH STATEMENT EXECUTE FUNCTION public.payslips_enforce_publication();


--
-- Name: sales sales_cash_closing_require_open; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sales_cash_closing_require_open BEFORE INSERT OR DELETE OR UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION public.sales_require_open_cash_closing();


--
-- Name: sales sales_cash_closing_require_open_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sales_cash_closing_require_open_truncate BEFORE TRUNCATE ON public.sales FOR EACH STATEMENT EXECUTE FUNCTION public.sales_require_open_cash_closing();


--
-- Name: sales_import_lines sales_import_lines_enforce_rows; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sales_import_lines_enforce_rows BEFORE INSERT OR DELETE OR UPDATE ON public.sales_import_lines FOR EACH ROW EXECUTE FUNCTION public.sales_import_lines_enforce();


--
-- Name: sales_import_lines sales_import_lines_enforce_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sales_import_lines_enforce_truncate BEFORE TRUNCATE ON public.sales_import_lines FOR EACH STATEMENT EXECUTE FUNCTION public.sales_import_lines_enforce();


--
-- Name: sales_import_skipped_lines sales_import_skipped_lines_enforce_rows; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sales_import_skipped_lines_enforce_rows BEFORE INSERT OR DELETE OR UPDATE ON public.sales_import_skipped_lines FOR EACH ROW EXECUTE FUNCTION public.sales_import_skipped_lines_enforce();


--
-- Name: sales_import_skipped_lines sales_import_skipped_lines_enforce_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sales_import_skipped_lines_enforce_truncate BEFORE TRUNCATE ON public.sales_import_skipped_lines FOR EACH STATEMENT EXECUTE FUNCTION public.sales_import_skipped_lines_enforce();


--
-- Name: sales_imports sales_imports_enforce_rows; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sales_imports_enforce_rows BEFORE INSERT OR DELETE OR UPDATE ON public.sales_imports FOR EACH ROW EXECUTE FUNCTION public.sales_imports_enforce();


--
-- Name: sales_imports sales_imports_enforce_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sales_imports_enforce_truncate BEFORE TRUNCATE ON public.sales_imports FOR EACH STATEMENT EXECUTE FUNCTION public.sales_imports_enforce();


--
-- Name: sales sales_tip_entry_consistency; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sales_tip_entry_consistency BEFORE INSERT OR UPDATE OF tip_entry_id, store_id, payment_method_id, sold_at ON public.sales FOR EACH ROW EXECUTE FUNCTION public.sales_check_tip_entry();


--
-- Name: tip_payment_batches tip_payment_batches_immutable_rows; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tip_payment_batches_immutable_rows BEFORE DELETE OR UPDATE ON public.tip_payment_batches FOR EACH ROW EXECUTE FUNCTION public.tip_payment_batches_enforce_immutability();


--
-- Name: tip_payment_batches tip_payment_batches_immutable_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tip_payment_batches_immutable_truncate BEFORE TRUNCATE ON public.tip_payment_batches FOR EACH STATEMENT EXECUTE FUNCTION public.tip_payment_batches_enforce_immutability();


--
-- Name: tip_payment_batches tip_payment_batches_totals; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER tip_payment_batches_totals AFTER INSERT ON public.tip_payment_batches DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.tip_payment_batches_assert_totals();


--
-- Name: tip_pool_daily_operation_sources tip_pool_daily_operation_sources_enforce_rows; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tip_pool_daily_operation_sources_enforce_rows BEFORE INSERT OR DELETE OR UPDATE ON public.tip_pool_daily_operation_sources FOR EACH ROW EXECUTE FUNCTION public.tip_pool_daily_operation_sources_enforce();


--
-- Name: tip_pool_daily_operation_sources tip_pool_daily_operation_sources_enforce_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tip_pool_daily_operation_sources_enforce_truncate BEFORE TRUNCATE ON public.tip_pool_daily_operation_sources FOR EACH STATEMENT EXECUTE FUNCTION public.tip_pool_daily_operation_sources_enforce();


--
-- Name: tip_pool_lines tip_pool_lines_hours_consistent_rows; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tip_pool_lines_hours_consistent_rows BEFORE INSERT OR UPDATE ON public.tip_pool_lines FOR EACH ROW EXECUTE FUNCTION public.tip_pool_children_hours_consistent();


--
-- Name: tip_pool_lines tip_pool_lines_require_draft; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tip_pool_lines_require_draft BEFORE INSERT OR DELETE OR UPDATE ON public.tip_pool_lines FOR EACH ROW EXECUTE FUNCTION public.tip_pool_children_require_draft();


--
-- Name: tip_pool_lines tip_pool_lines_require_draft_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tip_pool_lines_require_draft_truncate BEFORE TRUNCATE ON public.tip_pool_lines FOR EACH STATEMENT EXECUTE FUNCTION public.tip_pool_children_require_draft();


--
-- Name: tip_pool_receipts tip_pool_receipts_hours_consistent_rows; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tip_pool_receipts_hours_consistent_rows BEFORE INSERT OR UPDATE ON public.tip_pool_receipts FOR EACH ROW EXECUTE FUNCTION public.tip_pool_children_hours_consistent();


--
-- Name: tip_pool_receipts tip_pool_receipts_immutability_rows; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tip_pool_receipts_immutability_rows BEFORE INSERT OR DELETE OR UPDATE ON public.tip_pool_receipts FOR EACH ROW EXECUTE FUNCTION public.tip_pool_receipts_enforce_immutability();


--
-- Name: tip_pool_receipts tip_pool_receipts_immutability_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tip_pool_receipts_immutability_truncate BEFORE TRUNCATE ON public.tip_pool_receipts FOR EACH STATEMENT EXECUTE FUNCTION public.tip_pool_receipts_enforce_immutability();


--
-- Name: tip_pool_sources tip_pool_sources_entry_consistency; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tip_pool_sources_entry_consistency BEFORE INSERT OR UPDATE OF pool_id, tip_entry_id ON public.tip_pool_sources FOR EACH ROW EXECUTE FUNCTION public.tip_pool_sources_check_entry();


--
-- Name: tip_pool_sources tip_pool_sources_require_draft; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tip_pool_sources_require_draft BEFORE INSERT OR DELETE OR UPDATE ON public.tip_pool_sources FOR EACH ROW EXECUTE FUNCTION public.tip_pool_children_require_draft();


--
-- Name: tip_pool_sources tip_pool_sources_require_draft_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tip_pool_sources_require_draft_truncate BEFORE TRUNCATE ON public.tip_pool_sources FOR EACH STATEMENT EXECUTE FUNCTION public.tip_pool_children_require_draft();


--
-- Name: tip_pools tip_pools_status_rows; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tip_pools_status_rows BEFORE DELETE OR UPDATE ON public.tip_pools FOR EACH ROW EXECUTE FUNCTION public.tip_pools_enforce_status();


--
-- Name: tip_pools tip_pools_status_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tip_pools_status_truncate BEFORE TRUNCATE ON public.tip_pools FOR EACH STATEMENT EXECUTE FUNCTION public.tip_pools_enforce_status();


--
-- Name: audit_logs audit_logs_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: cash_closing_lines cash_closing_lines_closing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_closing_lines
    ADD CONSTRAINT cash_closing_lines_closing_id_fkey FOREIGN KEY (closing_id) REFERENCES public.cash_closings(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: cash_closing_lines cash_closing_lines_payment_method_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_closing_lines
    ADD CONSTRAINT cash_closing_lines_payment_method_id_fkey FOREIGN KEY (payment_method_id) REFERENCES public.payment_methods(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: cash_closing_tip_entries cash_closing_tip_entries_closing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_closing_tip_entries
    ADD CONSTRAINT cash_closing_tip_entries_closing_id_fkey FOREIGN KEY (closing_id) REFERENCES public.cash_closings(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: cash_closing_tip_entries cash_closing_tip_entries_tip_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_closing_tip_entries
    ADD CONSTRAINT cash_closing_tip_entries_tip_entry_id_fkey FOREIGN KEY (tip_entry_id) REFERENCES public.tip_entries(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: cash_closing_vouchers cash_closing_vouchers_closing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_closing_vouchers
    ADD CONSTRAINT cash_closing_vouchers_closing_id_fkey FOREIGN KEY (closing_id) REFERENCES public.cash_closings(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: cash_closing_vouchers cash_closing_vouchers_payment_method_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_closing_vouchers
    ADD CONSTRAINT cash_closing_vouchers_payment_method_id_fkey FOREIGN KEY (payment_method_id) REFERENCES public.payment_methods(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: cash_closings cash_closings_closed_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_closings
    ADD CONSTRAINT cash_closings_closed_by_id_fkey FOREIGN KEY (closed_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: cash_closings cash_closings_responsible_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_closings
    ADD CONSTRAINT cash_closings_responsible_id_fkey FOREIGN KEY (responsible_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: cash_closings cash_closings_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_closings
    ADD CONSTRAINT cash_closings_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: daily_operation_participants daily_operation_participants_operation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_operation_participants
    ADD CONSTRAINT daily_operation_participants_operation_id_fkey FOREIGN KEY (operation_id) REFERENCES public.daily_operations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: daily_operation_participants daily_operation_participants_worker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_operation_participants
    ADD CONSTRAINT daily_operation_participants_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: daily_operations daily_operations_responsible_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_operations
    ADD CONSTRAINT daily_operations_responsible_id_fkey FOREIGN KEY (responsible_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: daily_operations daily_operations_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_operations
    ADD CONSTRAINT daily_operations_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: daily_operations daily_operations_voucher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_operations
    ADD CONSTRAINT daily_operations_voucher_id_fkey FOREIGN KEY (voucher_id) REFERENCES public.daily_operation_vouchers(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: daily_tip_allocations daily_tip_allocations_operation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_tip_allocations
    ADD CONSTRAINT daily_tip_allocations_operation_id_fkey FOREIGN KEY (operation_id) REFERENCES public.daily_operations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: daily_tip_allocations daily_tip_allocations_payment_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_tip_allocations
    ADD CONSTRAINT daily_tip_allocations_payment_batch_id_fkey FOREIGN KEY (payment_batch_id) REFERENCES public.tip_payment_batches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: daily_tip_allocations daily_tip_allocations_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_tip_allocations
    ADD CONSTRAINT daily_tip_allocations_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: daily_tip_allocations daily_tip_allocations_worker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_tip_allocations
    ADD CONSTRAINT daily_tip_allocations_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: data_rights_requests data_rights_requests_resolved_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_rights_requests
    ADD CONSTRAINT data_rights_requests_resolved_by_id_fkey FOREIGN KEY (resolved_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: data_rights_requests data_rights_requests_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_rights_requests
    ADD CONSTRAINT data_rights_requests_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: document_versions document_versions_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_versions
    ADD CONSTRAINT document_versions_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: document_versions document_versions_uploaded_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_versions
    ADD CONSTRAINT document_versions_uploaded_by_id_fkey FOREIGN KEY (uploaded_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: documents documents_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: documents documents_current_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_current_version_id_fkey FOREIGN KEY (current_version_id) REFERENCES public.document_versions(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: documents documents_document_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_document_type_id_fkey FOREIGN KEY (document_type_id) REFERENCES public.document_types(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: documents documents_dt_registered_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_dt_registered_by_id_fkey FOREIGN KEY (dt_registered_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: documents documents_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: documents documents_subject_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_subject_user_id_fkey FOREIGN KEY (subject_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_count_lines inventory_count_lines_count_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_lines
    ADD CONSTRAINT inventory_count_lines_count_id_fkey FOREIGN KEY (count_id) REFERENCES public.inventory_counts(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: inventory_count_lines inventory_count_lines_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_lines
    ADD CONSTRAINT inventory_count_lines_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_count_lines inventory_count_lines_saved_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_lines
    ADD CONSTRAINT inventory_count_lines_saved_by_id_fkey FOREIGN KEY (saved_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_counts inventory_counts_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_counts
    ADD CONSTRAINT inventory_counts_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_counts inventory_counts_finalized_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_counts
    ADD CONSTRAINT inventory_counts_finalized_by_id_fkey FOREIGN KEY (finalized_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_counts inventory_counts_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_counts
    ADD CONSTRAINT inventory_counts_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_movements inventory_movements_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_movements inventory_movements_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_movements inventory_movements_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_template_rows inventory_template_rows_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_template_rows
    ADD CONSTRAINT inventory_template_rows_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: payment_method_aliases payment_method_aliases_payment_method_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_method_aliases
    ADD CONSTRAINT payment_method_aliases_payment_method_id_fkey FOREIGN KEY (payment_method_id) REFERENCES public.payment_methods(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: payslips payslips_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payslips
    ADD CONSTRAINT payslips_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: payslips payslips_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payslips
    ADD CONSTRAINT payslips_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: payslips payslips_published_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payslips
    ADD CONSTRAINT payslips_published_by_id_fkey FOREIGN KEY (published_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: payslips payslips_worker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payslips
    ADD CONSTRAINT payslips_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: refresh_tokens refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sales sales_cash_closing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_cash_closing_id_fkey FOREIGN KEY (cash_closing_id) REFERENCES public.cash_closings(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sales_import_lines sales_import_lines_import_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_import_lines
    ADD CONSTRAINT sales_import_lines_import_id_fkey FOREIGN KEY (import_id) REFERENCES public.sales_imports(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sales_import_lines sales_import_lines_payment_method_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_import_lines
    ADD CONSTRAINT sales_import_lines_payment_method_id_fkey FOREIGN KEY (payment_method_id) REFERENCES public.payment_methods(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sales_import_skipped_lines sales_import_skipped_lines_import_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_import_skipped_lines
    ADD CONSTRAINT sales_import_skipped_lines_import_id_fkey FOREIGN KEY (import_id) REFERENCES public.sales_imports(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sales_imports sales_imports_confirmed_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_imports
    ADD CONSTRAINT sales_imports_confirmed_by_id_fkey FOREIGN KEY (confirmed_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sales_imports sales_imports_resolved_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_imports
    ADD CONSTRAINT sales_imports_resolved_by_id_fkey FOREIGN KEY (resolved_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sales_imports sales_imports_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_imports
    ADD CONSTRAINT sales_imports_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sales_imports sales_imports_uploaded_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_imports
    ADD CONSTRAINT sales_imports_uploaded_by_id_fkey FOREIGN KEY (uploaded_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sales sales_payment_method_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_payment_method_id_fkey FOREIGN KEY (payment_method_id) REFERENCES public.payment_methods(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sales sales_registered_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_registered_by_id_fkey FOREIGN KEY (registered_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sales sales_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sales sales_tip_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_tip_entry_id_fkey FOREIGN KEY (tip_entry_id) REFERENCES public.tip_entries(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: store_closures store_closures_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_closures
    ADD CONSTRAINT store_closures_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: store_closures store_closures_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_closures
    ADD CONSTRAINT store_closures_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: store_external_codes store_external_codes_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_external_codes
    ADD CONSTRAINT store_external_codes_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: store_operating_schedules store_operating_schedules_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_operating_schedules
    ADD CONSTRAINT store_operating_schedules_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: store_operating_schedules store_operating_schedules_updated_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_operating_schedules
    ADD CONSTRAINT store_operating_schedules_updated_by_id_fkey FOREIGN KEY (updated_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: tip_agreements tip_agreements_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_agreements
    ADD CONSTRAINT tip_agreements_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: tip_agreements tip_agreements_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_agreements
    ADD CONSTRAINT tip_agreements_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: tip_entries tip_entries_payment_method_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_entries
    ADD CONSTRAINT tip_entries_payment_method_id_fkey FOREIGN KEY (payment_method_id) REFERENCES public.payment_methods(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: tip_entries tip_entries_responsible_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_entries
    ADD CONSTRAINT tip_entries_responsible_id_fkey FOREIGN KEY (responsible_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: tip_entries tip_entries_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_entries
    ADD CONSTRAINT tip_entries_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: tip_payment_batches tip_payment_batches_legacy_pool_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_payment_batches
    ADD CONSTRAINT tip_payment_batches_legacy_pool_id_fkey FOREIGN KEY (legacy_pool_id) REFERENCES public.tip_pools(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: tip_payment_batches tip_payment_batches_paid_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_payment_batches
    ADD CONSTRAINT tip_payment_batches_paid_by_id_fkey FOREIGN KEY (paid_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: tip_payment_batches tip_payment_batches_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_payment_batches
    ADD CONSTRAINT tip_payment_batches_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: tip_pool_daily_operation_sources tip_pool_daily_operation_sources_operation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_pool_daily_operation_sources
    ADD CONSTRAINT tip_pool_daily_operation_sources_operation_id_fkey FOREIGN KEY (operation_id) REFERENCES public.daily_operations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: tip_pool_daily_operation_sources tip_pool_daily_operation_sources_pool_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_pool_daily_operation_sources
    ADD CONSTRAINT tip_pool_daily_operation_sources_pool_id_fkey FOREIGN KEY (pool_id) REFERENCES public.tip_pools(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: tip_pool_lines tip_pool_lines_pool_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_pool_lines
    ADD CONSTRAINT tip_pool_lines_pool_id_fkey FOREIGN KEY (pool_id) REFERENCES public.tip_pools(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: tip_pool_lines tip_pool_lines_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_pool_lines
    ADD CONSTRAINT tip_pool_lines_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: tip_pool_lines tip_pool_lines_work_hours_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_pool_lines
    ADD CONSTRAINT tip_pool_lines_work_hours_record_id_fkey FOREIGN KEY (work_hours_record_id) REFERENCES public.work_hours_records(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: tip_pool_receipts tip_pool_receipts_paid_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_pool_receipts
    ADD CONSTRAINT tip_pool_receipts_paid_by_id_fkey FOREIGN KEY (paid_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: tip_pool_receipts tip_pool_receipts_pool_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_pool_receipts
    ADD CONSTRAINT tip_pool_receipts_pool_id_fkey FOREIGN KEY (pool_id) REFERENCES public.tip_pools(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: tip_pool_receipts tip_pool_receipts_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_pool_receipts
    ADD CONSTRAINT tip_pool_receipts_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: tip_pool_receipts tip_pool_receipts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_pool_receipts
    ADD CONSTRAINT tip_pool_receipts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: tip_pool_sources tip_pool_sources_pool_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_pool_sources
    ADD CONSTRAINT tip_pool_sources_pool_id_fkey FOREIGN KEY (pool_id) REFERENCES public.tip_pools(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: tip_pool_sources tip_pool_sources_tip_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_pool_sources
    ADD CONSTRAINT tip_pool_sources_tip_entry_id_fkey FOREIGN KEY (tip_entry_id) REFERENCES public.tip_entries(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: tip_pools tip_pools_agreement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_pools
    ADD CONSTRAINT tip_pools_agreement_id_fkey FOREIGN KEY (agreement_id) REFERENCES public.tip_agreements(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: tip_pools tip_pools_calculated_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_pools
    ADD CONSTRAINT tip_pools_calculated_by_id_fkey FOREIGN KEY (calculated_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: tip_pools tip_pools_confirmed_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_pools
    ADD CONSTRAINT tip_pools_confirmed_by_id_fkey FOREIGN KEY (confirmed_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: tip_pools tip_pools_paid_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_pools
    ADD CONSTRAINT tip_pools_paid_by_id_fkey FOREIGN KEY (paid_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: tip_pools tip_pools_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tip_pools
    ADD CONSTRAINT tip_pools_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: users users_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: users users_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: work_hours_records work_hours_records_recorded_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_hours_records
    ADD CONSTRAINT work_hours_records_recorded_by_id_fkey FOREIGN KEY (recorded_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: work_hours_records work_hours_records_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_hours_records
    ADD CONSTRAINT work_hours_records_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: work_hours_records work_hours_records_worker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_hours_records
    ADD CONSTRAINT work_hours_records_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--


