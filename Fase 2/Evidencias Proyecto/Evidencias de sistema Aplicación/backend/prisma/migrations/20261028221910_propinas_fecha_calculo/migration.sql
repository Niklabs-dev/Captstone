-- SPRINT-3-T13 (revisión del PR #52): instante del último cálculo del reparto.
-- updated_at también cambia al observar, confirmar y pagar, así que no sirve
-- como fecha de cálculo. calculated_at solo cambia al calcular o recalcular
-- un DRAFT y queda fijo desde la confirmación.

-- AlterTable
ALTER TABLE "tip_pools" ADD COLUMN     "calculated_at" TIMESTAMPTZ(6);

-- Las filas existentes toman su updated_at como mejor aproximación. El
-- trigger de estados rechaza todo UPDATE de un reparto PAID, así que se
-- desactiva solo mientras dura el relleno, dentro de la transacción de la
-- migración (otra sesión no puede escribir en tip_pools mientras tanto: el
-- ALTER TABLE toma un bloqueo exclusivo de la tabla).
ALTER TABLE "tip_pools" DISABLE TRIGGER "tip_pools_status_rows";
UPDATE "tip_pools" SET "calculated_at" = "updated_at";
ALTER TABLE "tip_pools" ENABLE TRIGGER "tip_pools_status_rows";

ALTER TABLE "tip_pools"
  ALTER COLUMN "calculated_at" SET NOT NULL,
  ALTER COLUMN "calculated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- Igual que en propinas_confirmacion_pago, más calculated_at entre los datos
-- que no cambian desde CONFIRMED.
CREATE OR REPLACE FUNCTION "tip_pools_enforce_status"() RETURNS trigger
LANGUAGE plpgsql AS $$
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
