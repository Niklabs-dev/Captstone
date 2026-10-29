# SPRINT-3-T08 — Regresión responsive continua

`npm run test:responsive` ejecuta secuencialmente ocho suites con NestJS,
Next.js y PostgreSQL reales. Reutiliza los recorridos funcionales de cada
entrega y sus fixtures; no sustituye la API por respuestas simuladas salvo
las pruebas explícitas de error de cada suite.

Requiere un entorno exclusivo, TEST_REAL_DISPOSABLE=true, DATABASE_URL,
TEST_REAL_FRONTEND_URL, TEST_REAL_BACKEND_URL y TEST_REAL_ADMIN_PASSWORD.
Para verificar archivos ausentes, configurar TEST_REAL_STORAGE_PATH y
levantar docker-compose.test.yml junto a los compose base y override.
El script prepara los datos sintéticos y configura navegación automáticamente.
No ejecutar sobre producción: las suites crean y modifican datos sintéticos.

Todas las suites usan escritorio y anchos 360, 390 y 768 px:

| Suite | Cobertura |
| --- | --- |
| navigation | Login UI, cuatro roles, menú, sesión, foco y controles de 44 px |
| user-management | Edición, reactivación, clave, diálogos y retorno del foco |
| real-api | Documentos/versiones/hash, alertas y liquidaciones/publicación/lectura |
| stores | CRUD, catálogo, diálogos, Escape y foco |
| my-documents | Portal documental y aislamiento |
| tips | Registro diario del supervisor |
| tip-pools | Revisión, confirmación, pago, observaciones y constancias del contador |
| my-tip-receipts | Constancias propias PAID y descarga íntegra del trabajador |

Las aserciones de cada recorrido verifican acciones visibles, límites de
página y/o diálogos y permisos. Los cuatro recorridos de real-api añaden
comprobación de overflow al finalizar; navegación y formularios comprueban
Escape y restauración de foco. Las tablas pueden desplazar su región interna.

El workflow sprint-3-t08-responsive.yml ejecuta la regresión en PR hacia main,
en la rama de T08 o manualmente. Compila producción en Docker y conserva
JUnit por suite, capturas, trazas de fallos y logs durante siete días. El
runner falla ante el primer error y no presenta suites posteriores como
aprobadas. Las suites pueden ejecutarse individualmente con su configuración.

La emulación usa Chromium; no acredita Safari ni teléfonos físicos.
Notion requiere registrar el commit final y En revisión; no marcar Hecho sin
confirmación del usuario.

## Ejecución en vivo

`npm run test:responsive:live` recorre la misma matriz abriendo Chromium
visible en el escritorio. Requiere el sistema local levantado y las mismas
variables y base exclusiva. No ejecutar mientras se compilan las imágenes:
la carga adicional puede causar tiempos de espera en equipos con poca memoria.

La comprobación de foco exige la clase focus-visible:outline-2, contorno sólido
y anchura cercana a 2 px (menos de un píxel de diferencia). Chromium visible
en Windows puede devolver 1,6 px por redondeo con la escala del escritorio;
una comparación textual con 2px fallaba aunque el token era correcto. Se
conservan la comprobación de foco activo y el mínimo táctil de 44 px.
