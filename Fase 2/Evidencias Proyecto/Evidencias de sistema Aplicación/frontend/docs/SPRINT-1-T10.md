# SPRINT-1-T10 — Gestión de usuarios del frontend

Rama: `feat/sprint-1-t10-gestion-usuarios`, creada desde `origin/main` (`500e679`).
Estado: **En revisión en GitHub**, [PR #18](https://github.com/Niklabs-dev/Captstone/pull/18).
Revisión solicitada a `Niklabs-dev`. Commit de implementación: `dfd0b59`.
No se ha cambiado el tablero de Notion,
porque la integración no tiene acceso a la página compartida. No se marca Hecho
sin aprobación del usuario y cumplimiento de la DoD.

## Alcance y criterios de aceptación

- `/admin/usuarios`: listado, búsqueda y filtros combinados por rol, local y estado.
- Alta con nombre, apellido, correo, contraseña inicial y los cuatro roles.
- Los roles de local requieren selección; administrador y contador no llevan local.
- Desactivación confirmada: conserva datos y documentos, bloquea nuevos ingresos
  y revoca la renovación de sesiones. La confirmación explica que las sesiones
  ya abiertas pueden seguir vigentes hasta vencer.
- La cuenta propia no se puede desactivar; se rechaza también en la API.
- Sesión verificada por NestJS y acceso exclusivo del administrador. Otros roles
  se redirigen al dashboard; visitantes o tokens falsos se redirigen al login.
- Antes de cada operación se verifica además el registro actual del administrador:
  una cuenta desactivada o cuyo rol haya cambiado no puede usar un JWT anterior
  para administrar usuarios.
- Las APIs rechazan solicitudes sin autorización y mutaciones de otro origen.
- Respuestas sin caché y con proyección explícita: no incluyen tokens, hashes ni
  datos personales innecesarios. Los errores del servidor no exponen detalles internos.
- Estados de carga, error, conflicto, confirmación y lista vacía; diálogos nativos
  con navegación de teclado y restauración del foco.

Diseño: mockup `Fase 1/Evidencias Grupales/Documentación del proyecto/Adicionales/Mockup/index.html`.
Se adoptan sidebar de 248 px, barra superior de 64 px, tarjetas blancas, paleta
salmón y crema, tabla, estados e Inter / JetBrains Mono. El mockup combina usuarios
y auditoría; la pantalla de auditoría pertenece a T16. No se muestran datos ni
indicadores de 2FA simulados.

## Dependencias e integración

Esta tarea conserva su rama y PR independientes desde main. El login y el dashboard
pertenecen a SPRINT-1-T09 (PR #16); deben integrarse para la navegación completa.
La sesión consume su contrato de cookie `mf_access`, sin copiar su implementación.
La redirección inicial por rol se deja a SPRINT-1-T11.

El backend no ofrece un endpoint de catálogo de locales. La pantalla combina los
locales asociados a usuarios existentes y el catálogo opcional del servidor
`USER_MANAGEMENT_STORES`. Sus IDs deben existir y estar activos; NestJS verifica
existencia y compatibilidad. La pantalla no pide UUIDs al usuario. Sin catálogo
ni locales asociados, los roles de local están deshabilitados y se explica el motivo.

No se modifica código ni schema del backend. No se agregan migraciones ni seeds
de producción. El local ficticio de las pruebas se prepara solamente en el
proyecto Compose exclusivo `capstone-sprint1-t10`.

## Pruebas reproducibles

Validación final en el entorno exclusivo de SPRINT-1-T10:

| Comprobación | Resultado |
| --- | --- |
| Lint y formato frontend / backend sin cambios | Aprobados |
| Pruebas unitarias | 14 aprobadas |
| Integración HTTP simulada | Aprobada |
| Playwright con frontend, NestJS y PostgreSQL reales en Docker | 10 aprobadas (escritorio y móvil) |
| Build frontend local y Docker | Aprobados |
| Build backend Docker | Aprobado |
| Migraciones y seed sobre volumen nuevo | 3 migraciones y seed correctos |
| Versiones existentes del lockfile | Sin actualizaciones; se añade Playwright |

El corte de red ECONNRESET durante una descarga de npm se resolvió reintentando
la compilación; la imagen final se compiló y ejecutó correctamente. Se revisaron
las capturas `desktop-users.png` y `mobile-users.png`: colores, fuentes y tabla
según el mockup, sin desbordamiento horizontal de la página.
Tras precisar el mensaje de desactivación, se recompilaron frontend local y
Docker y se repitieron los dos flujos de alta/desactivación (escritorio y móvil).

Desde `frontend/`:

```powershell
npm ci
npm run lint
npm run format:check
npm run test:users
npm run build
npm run test:users:integration
npx playwright install chromium
# Configurar TEST_USERS_ADMIN_EMAIL / TEST_USERS_ADMIN_PASSWORD con el seed de pruebas.
./scripts/test-users.ps1
```

La suite unitaria valida datos, restricciones de rol/local, límites de contraseña,
proyección de respuestas, filtros, catálogo, origen y manejo de errores.
La integración HTTP usa Next.js compilado y un contrato de backend controlado
para verificar JWT, RBAC, mutaciones, conflictos y respuestas inválidas.
Playwright usa Next.js, NestJS y PostgreSQL reales en Docker en escritorio y móvil:
creación, duplicados, búsqueda, filtros, cancelación y confirmación, asignación de
local, acceso por rol, rechazo de JWT falso, cuenta propia, CSRF y auditoría.

El volumen exclusivo mantiene cuentas ficticias desactivadas y su auditoría para
inspección; no se modifica el volumen de T09 ni datos del usuario. Capturas y trazas
quedan en `test-results/`, excluidas de Git. No se ejecuta contra producción.

## Entrega

Las pruebas detectaron que `/auth/me` conserva la validez de un access token hasta
su expiración aunque se desactive la cuenta; `JwtStrategy` documenta ese comportamiento.
Login y renovación sí quedan bloqueados. Esta tarea verifica el registro vigente
para proteger la página y APIs de usuarios de inmediato. Generalizar esa verificación
en todos los endpoints del backend requiere una tarea independiente, sin mezclar
cambios de NestJS en este PR frontend.

La suite general existente del backend tenía fallos de inicialización de
dependencias en Vitest y de ejecución de npx en Windows, registrados en T09.
No se corrigen mezclándolos con esta tarea frontend. La aceptación final, merge
y actualización del tablero permanecen pendientes de revisión.
