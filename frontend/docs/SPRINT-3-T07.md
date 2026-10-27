# SPRINT-3-T07 — Vistas autenticadas en móvil

Se conserva el layout, la paleta y la autorización existentes. La tarea adapta
las vistas entregadas de administrador, contador, supervisor y trabajador.
Los flujos de propinas todavía pendientes en main se incorporarán en sus
propias tareas; no se añaden pantallas simuladas.

## Comportamiento

- Hasta 1023 px, «Menú principal» despliega los enlaces en una columna.
  Conserva la cuenta visible y el acceso a «Mi sesión». El botón anuncia
  su estado, Escape cierra y devuelve el foco, y navegar cierra el menú.
  Desde 1024 px permanece la barra lateral. Se conserva el mismo elemento
  de navegación al cambiar de página.
- Los filtros mantienen una columna en teléfono y recuperan su distribución
  de escritorio cuando hay espacio. Inputs y selects tienen un mínimo de
  44 px y texto de 16 px en móvil, para evitar el zoom al enfocar en iOS.
- Los diálogos comparten ancho limitado al viewport, altura basada en
  `100dvh`, desplazamiento interno y ajuste de textos largos. Sus acciones
  se apilan en móvil y vuelven a fila desde 640 px. Se conservan Escape,
  bloqueo durante operaciones y restauración de foco de cada diálogo.
- Las tablas de usuarios, locales, auditoría, documentos y liquidaciones
  conservan todas sus columnas y acciones. Su región desplazable tiene
  nombre accesible, acceso por teclado y una indicación de desplazamiento
  en móvil; no se oculta el desbordamiento de toda la página.
- La cabecera permite títulos largos y mantiene «Mi sesión» dentro del
  viewport. Renovar y cerrar sesión aparecen como acciones separadas.

## Verificación reproducible

Usar Node 24 y un entorno exclusivo con datos sintéticos. No ejecutar los
fixtures ni las pruebas de mutación contra producción.

```powershell
npm ci
npm run lint
npm run format:check
npm run build
npx tsc -p tsconfig.test.json
node --test .test-build/auth.test.js .test-build/users.test.js .test-build/audit.test.js .test-build/navigation.test.js .test-build/backend-proxy.test.js .test-build/display-date.test.js .test-build/documents.test.js .test-build/dt-alerts.test.js .test-build/payroll.test.js .test-build/my-payslips.test.js .test-build/my-documents.test.js .test-build/stores.test.js
```

La suite existente `playwright.navigation.config.ts` comprueba escritorio,
360, 390 y 768 px. Sus variables `TEST_NAVIGATION_*` se describen en
`.env.example`. Los recorridos de locales, usuarios, documentos y
liquidaciones conservan sus suites de integración real existentes.
Los helpers de navegación abren el menú cuando está colapsado.

El workflow `.github/workflows/sprint-3-t07-responsive.yml` compila el sistema,
aplica migraciones en una base efímera, prepara fixtures y ejecuta esas suites.
Conserva resultados, capturas y trazas durante siete días como artefactos de
GitHub Actions. Las capturas y reportes locales permanecen fuera de Git.

La emulación de Chromium verifica distribución y recorridos; no sustituye
una comprobación en teléfonos físicos ni permite afirmar compatibilidad
con Safari a partir de Chromium. La regresión transversal ampliada de T08
mantiene su seguimiento independiente.

La entrega queda para revisión del equipo; no se marca Hecho automáticamente.
