# DESIGN.md — Directrices de estilo del frontend Moi-food

Guía obligatoria para cualquier vista o componente nuevo del frontend. Su objetivo
es que todas las pantallas se vean y se comporten igual, sin temas por módulo ni
estilos duplicados. Si un cambio necesita salirse de estas reglas, primero se
actualiza este archivo en el mismo PR y se justifica en la descripción.

## Principios

1. **Una sola fuente por decisión de diseño.** Los colores viven en
   `src/app/globals.css`; las clases de los componentes, en
   `src/components/ui/styles.ts`; el layout privado, en `ApplicationShell`.
2. **Reutilizar antes de crear.** Si existe una constante en `styles.ts`, se usa.
   Si un patrón nuevo aparece en dos vistas o más, se agrega a `styles.ts` en vez
   de copiar las clases.
3. **Sin temas por módulo.** Prohibido crear archivos CSS propios, un segundo
   `@import 'tailwindcss'`, paletas con prefijo (`u-*`, etc.) o layouts que
   vuelvan a cargar fuentes o fondos.
4. **Accesible por defecto.** Foco visible, objetivos táctiles de 44 px, contraste
   legible y textos en español.
5. **Solo tema claro.** El sistema no tiene modo oscuro; no se agregan variantes
   `dark:` mientras no exista una decisión de diseño al respecto.

## Colores

Todos los colores se definen como tokens en `@theme static` de `globals.css` y se
usan con las utilidades de Tailwind (`bg-tint`, `text-ink2`, `border-line`…).
**Nunca** se escriben hexadecimales, `rgb()` ni colores arbitrarios
(`text-[#…]`) en los componentes. Un color nuevo se agrega primero como token.

| Token              | Valor                 | Uso                                                                           |
| ------------------ | --------------------- | ----------------------------------------------------------------------------- |
| `bg`               | `#ffffff`             | Superficie de tarjetas, paneles, cabecera, menú, inputs y diálogos            |
| `tint`             | `#fef4ef`             | Fondo de la página, hover de filas y botones secundarios, encabezado de tabla |
| `tint2`            | `#fce9df`             | Enlace activo del menú, badges neutros de marca, avisos informativos          |
| `tint3`            | `#f9dccb`             | Selección de texto                                                            |
| `line`             | `#f3e4db`             | Bordes de tarjetas, paneles, separadores y filas                              |
| `line2`            | `#ead5c9`             | Bordes de inputs y botones secundarios                                        |
| `salmon`           | `#ff8b52`             | Fondo del botón primario                                                      |
| `salmon-deep`      | `#e96f33`             | Hover del botón primario y «Food» en la marca                                 |
| `salmon-ink`       | `#b44e1b`             | Texto de botones secundarios y enlaces, contorno de foco, rol en la cuenta    |
| `ink`              | `#2e2320`             | Texto principal y texto sobre el botón primario                               |
| `ink2`             | `#5c4a41`             | Texto secundario, etiquetas y descripciones                                   |
| `muted`            | `#78645d`             | Metadatos, placeholders, IDs y textos de menor jerarquía                      |
| `crit` / `crit-bg` | `#b4382b` / `#fbebe8` | Errores, estado «Desactivado» y acciones destructivas                         |
| `ok` / `ok-bg`     | `#237a55` / `#e9f6f0` | Estado «Activo» y confirmaciones                                              |
| `warn` / `warn-bg` | `#d98a1f` / `#fcf2e2` | Advertencias y plazos próximos a vencer                                       |
| `info` / `info-bg` | `#35669f` / `#ecf2fa` | Información neutra (por ejemplo, el rol Contador)                             |

Reglas de color:

- El botón primario lleva **texto `ink` sobre `salmon`**. El texto blanco sobre
  salmón no alcanza el contraste mínimo.
- Los colores de estado (`crit`, `ok`, `warn`, `info`) se usan siempre en pareja:
  texto con el color fuerte sobre su fondo `-bg`.
- El color nunca es la única señal: los estados llevan texto («Activo»,
  «Desactivado») y, si aplica, un punto o ícono `aria-hidden`.

## Tipografía

Las fuentes se cargan **una sola vez** en `src/app/layout.tsx` con `next/font`:
**Inter** (`font-sans`, por defecto) y **JetBrains Mono** (`font-mono`).

La escala permitida es la siguiente; no se agregan tamaños arbitrarios fuera de ella.

| Tamaño  | Clase                                  | Uso                                                                 |
| ------- | -------------------------------------- | ------------------------------------------------------------------- |
| 10 px   | `text-[10px]` + `font-mono uppercase`  | Leyenda de marca, encabezados de tabla y eyebrows                   |
| 11 px   | `text-[11px]`                          | Metadatos en tablas (correo bajo el nombre, fechas en mono, IDs)    |
| 12 px   | `text-xs`                              | Etiquetas de formulario, badges, ayudas y descripciones de tabla    |
| 13 px   | `text-[13px]`                          | Cuerpo de tablas y correo de la cuenta en el menú                   |
| 13,5 px | `text-[13.5px]`                        | Enlaces del menú lateral                                            |
| 14 px   | `text-sm`                              | Controles, botones, párrafos de introducción y títulos de panel     |
| 16 px   | `text-base`                            | Texto base y título de la marca                                     |
| 17 px   | `text-[17px] font-bold tracking-tight` | Título de la vista en la cabecera (`ApplicationHeading`)            |
| 18 px   | `text-lg font-bold`                    | Título de diálogos y del login                                      |
| 20 px   | `text-xl font-bold`                    | Título principal dentro de una tarjeta de bienvenida o recuperación |

Pesos: `font-normal` en texto e inputs, `font-medium` para resaltar dentro de una
celda, `font-semibold` en etiquetas, botones y badges, `font-bold` en títulos y
`font-extrabold` solo en la marca.

`font-mono` se reserva para datos técnicos: encabezados de tabla, fechas y horas,
códigos de operación (`USER_LOGIN`), IDs de registro y la leyenda «Gestión
interna». No se usa en párrafos ni en botones.

## Espaciado, forma y elevación

- **Radios:** `rounded-lg` (8 px) en inputs, botones y avisos;
  `rounded-[14px]` en tarjetas y paneles; `rounded-xl` en el logo, los avisos
  destacados y el panel «Mi sesión»; `rounded-2xl` en diálogos y en la tarjeta de
  login; `rounded-full` en badges.
- **Paneles:** `p-5`; tarjetas de bienvenida o resumen: `p-6`.
- **Separación vertical** entre bloques de una vista: la da `main` con
  `space-y-5`. Dentro de un formulario, `space-y-4` entre campos y `space-y-2`
  entre etiqueta y control.
- **Bordes antes que sombras:** las superficies se separan con `border-line`. Las
  sombras se reservan para capas flotantes: `shadow-lg` en «Mi sesión» y
  `shadow-xl` en diálogos.

## Layout de las vistas privadas

- Toda vista autenticada vive en `src/app/(authenticated)/`. Su
  `layout.tsx` valida la sesión en servidor y envuelve el contenido en
  `ApplicationShell` (menú lateral de 248 px, cabecera con el título de la vista y
  «Mi sesión», y datos de la cuenta).
- **Ninguna página ni `loading.tsx` vuelve a envolver su contenido en
  `ApplicationShell`**: duplicaría el menú.
- Una vista nueva se registra en `src/lib/navigation.ts`:
  `getNavigationItems()` define el menú según rol y `getNavigationView()` el
  título de la cabecera. La página no dibuja su propio `<h1>`; lo pone
  `ApplicationHeading`.
- Los errores usan `app/(authenticated)/error.tsx` y los fallos de sesión
  `SessionUnavailable` / `SessionRecovery`. No se crean pantallas de error propias
  por módulo.
- **Móvil:** el diseño debe funcionar a 390 px de ancho sin scroll horizontal de
  la página. Las tablas se desplazan dentro de su contenedor.

### Estructura de una vista de gestión

Usuarios y Auditoría definen el patrón que siguen las vistas de listado:

1. Párrafo de introducción con `introClass`.
2. Panel de filtros: `<section>` con `filterPanelClass`, título `<h2>` con
   `panelTitleClass` y `aria-labelledby`, campos en grilla y acciones
   (primaria + secundaria) al final.
3. Avisos: error con `role="alert"` y estado con `role="status"`.
4. Panel de tabla: `<section>` con `tablePanelClass`, cabecera con
   `tableHeaderClass` (título `panelTitleClass`, descripción
   `tableDescriptionClass` y badge opcional a la derecha), la tabla y un pie con
   el conteo o la paginación separado por `border-t border-line`.

## Componentes

Usar siempre las constantes de `src/components/ui/styles.ts`:

| Elemento          | Constante                                                             | Notas                                                                                      |
| ----------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Input y select    | `inputClass`                                                          | 44 px de alto, `text-sm`, foco con contorno `salmon-ink`                                   |
| Botón secundario  | `buttonClass`                                                         | Borde `line2`, texto `salmon-ink`, hover `tint`. También para enlaces con aspecto de botón |
| Botón primario    | `primaryButtonClass`                                                  | Una sola acción primaria por bloque                                                        |
| Botón destructivo | `dangerButtonClass`                                                   | Solo para confirmar acciones irreversibles dentro de un diálogo                            |
| Etiqueta          | `labelClass`                                                          | 12 px semibold `ink2`. Toda entrada tiene una etiqueta visible                             |
| Introducción      | `introClass`                                                          | Primer párrafo de la vista                                                                 |
| Panel de filtros  | `filterPanelClass` + `panelTitleClass`                                |                                                                                            |
| Panel de tabla    | `tablePanelClass` + `tableHeaderClass` + `tableDescriptionClass`      |                                                                                            |
| Tabla             | `tableClass`, `tableHeadClass`, `tableHeadingClass`, `tableCellClass` | Filas con `border-b border-line last:border-b-0 hover:bg-tint`                             |
| Badge             | `badgeClass` + pareja de colores                                      | Ej.: `bg-ok-bg text-ok`, `bg-tint2 text-salmon-ink`                                        |
| Marca             | `brandTitleClass` + `brandCaptionClass`                               | «Moi» en `ink` y «Food» en `salmon-deep`; leyenda «Gestión interna»                        |

Para variantes de ancho o margen se compone la constante: `` `${buttonClass} w-full` ``,
`` `${inputClass} mt-2` ``. No se reescriben sus clases internas.

Otras reglas de componentes:

- **Enlaces deshabilitados** (paginación): `` `${buttonClass} pointer-events-none opacity-50` ``
  con `aria-disabled="true"`, renderizados como `<span>`.
- **Diálogos:** `<dialog>` nativo con `showModal()`, `aria-label` igual al título,
  botón de cierre «×» con `aria-label="Cerrar ventana"` y fondo
  `backdrop:bg-ink/35`. Escape cierra el diálogo salvo que haya una operación en
  curso.
- **Avisos en línea:** error `rounded-lg border border-crit/20 bg-crit-bg px-3.5 py-3 text-sm text-crit`;
  información `rounded-xl border border-line2 bg-tint2 p-4 text-sm text-ink2`.
- **Íconos:** no se usan emojis en la interfaz. Si se agregan íconos, se definen
  en un único componente compartido y llevan `aria-hidden="true"` cuando son
  decorativos.

## Accesibilidad

- Objetivo táctil mínimo de **44 px** (`min-h-11`) en todo control interactivo.
- Foco visible en todo elemento enfocable:
  `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-salmon-ink`.
  Nunca `outline-none` sin un reemplazo visible.
- Cada `<section>` lleva `aria-labelledby` apuntando a su título.
- Tablas: `<caption className="sr-only">`, `<th scope="col">` y, si se
  desplazan, un contenedor con `role="region"`, `aria-label` y `tabIndex={0}`.
- Errores con `role="alert"`; mensajes de estado y confirmaciones con
  `role="status"`; contenedores en carga con `aria-busy`.
- El enlace activo del menú lleva `aria-current="page"`.
- Contraste mínimo WCAG AA (4,5:1 en texto normal). Usar `ink2` o `muted` para
  texto secundario, nunca grises más claros.

## Textos de la interfaz

- Español de Chile, tuteo y frases en mayúscula inicial (no Title Case).
- Botones con verbo en infinitivo y objeto: «Guardar usuario», «Aplicar filtros».
- Estados de carga con puntos suspensivos tipográficos: «Cargando…», «Creando…».
- Fechas y horas en hora de Chile, indicándolo cuando sea relevante.
- Los mensajes de error explican qué hacer a continuación y nunca muestran
  mensajes internos del backend.

## Deuda conocida

Desvíos existentes que deben corregirse cuando se toque el archivo:

- `ApplicationShell.tsx`: el `<summary>` de «Mi sesión» repite a mano las clases
  del botón secundario; debería usar `buttonClass`. El panel no se cierra con
  Escape ni con un clic fuera.
- `ApplicationNavigation.tsx`: los enlaces del menú usan `rounded-[9px]`; el radio
  estándar es `rounded-lg`.
- `portal/page.tsx`: el eyebrow «Bienvenido a MoiFood» usa `text-[9.5px]`; debe
  usar `text-[10px]`, como `brandCaptionClass`.
- `SessionUnavailable.tsx`: muestra la marca sin el logo, a diferencia del login
  y del menú.

## Checklist antes de abrir un PR con cambios visuales

- [ ] No hay colores hexadecimales, tamaños fuera de la escala ni archivos CSS nuevos.
- [ ] Controles, tablas, badges y paneles usan las constantes de `ui/styles.ts`.
- [ ] La vista nueva está registrada en `src/lib/navigation.ts` y no vuelve a
      envolver `ApplicationShell`.
- [ ] Se revisó con playwright-cli en 1440×900 y 390×844: mismos estilos
      calculados que las vistas existentes, foco visible al navegar con Tab y sin
      scroll horizontal.
- [ ] Se probaron los estados de carga, vacío y error.
- [ ] Si se cambió una regla de este documento, `DESIGN.md` se actualizó en el
      mismo PR.

## Consulta personal de liquidaciones

El mockup del portal utiliza tarjetas semánticas `<ul>` para agrupar cada PDF con su período, firma, integridad y descarga. Se permite este patrón en consultas personales de solo lectura: sección con título accesible, `tablePanelClass`, separadores `border-line`, conteo y controles compartidos. Las vistas administrativas mantienen el patrón de tabla.
