-- Solo se ejecuta contra el volumen exclusivo capstone-sprint1-t16.
-- La auditoría es inmutable: los registros ficticios se conservan en ese volumen.
INSERT INTO stores (id, name, city, address, is_active, updated_at)
VALUES
  ('10000000-0000-4000-8000-000000000016', 'Local de prueba T16', 'Prueba', 'Direccion ficticia', true, now()),
  ('20000000-0000-4000-8000-000000000016', 'Otro local de prueba T16', 'Prueba', 'Direccion ficticia', true, now())
ON CONFLICT (id) DO NOTHING;

WITH responsible AS (
  SELECT users.id FROM users JOIN roles ON users.role_id = roles.id
  WHERE roles.code = 'ADMINISTRADOR' AND users.is_active = true
  ORDER BY users.created_at LIMIT 1
), fixtures(action, instant, store_id) AS (
  VALUES
    ('AUDIT_T16_BOUNDARY_START', '2026-10-05T03:00:00Z', '10000000-0000-4000-8000-000000000016'),
    ('AUDIT_T16_BOUNDARY_END', '2026-10-06T02:59:59Z', '10000000-0000-4000-8000-000000000016'),
    ('AUDIT_T16_BEFORE', '2026-10-05T02:59:59Z', '10000000-0000-4000-8000-000000000016'),
    ('AUDIT_T16_AFTER', '2026-10-06T03:00:00Z', '10000000-0000-4000-8000-000000000016'),
    ('AUDIT_T16_OTHER_STORE', '2026-10-05T12:00:00Z', '20000000-0000-4000-8000-000000000016'),
    ('AUDIT_T16_GLOBAL', '2026-10-05T12:00:00Z', NULL)
)
INSERT INTO audit_logs (action, entity_type, user_id, store_id, detail, created_at)
SELECT fixtures.action, 'test_audit_t16', responsible.id, fixtures.store_id::uuid,
  '{"fixture":true}'::jsonb, fixtures.instant::timestamptz
FROM fixtures CROSS JOIN responsible
WHERE NOT EXISTS (SELECT 1 FROM audit_logs existing WHERE existing.entity_type = 'test_audit_t16' AND existing.action = fixtures.action);

INSERT INTO audit_logs (action, entity_type, store_id, detail, created_at)
SELECT 'AUDIT_T16_PAGE', 'test_audit_t16',
  '10000000-0000-4000-8000-000000000016'::uuid,
  jsonb_build_object('fixture', true, 'position', position),
  '2026-10-05T12:00:00Z'::timestamptz
FROM generate_series(1, 30) AS series(position)
WHERE NOT EXISTS (SELECT 1 FROM audit_logs WHERE entity_type = 'test_audit_t16' AND action = 'AUDIT_T16_PAGE');
