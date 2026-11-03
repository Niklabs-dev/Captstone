---
name: MoiFood
description: Sistema visual de gestión interna con identidad naranja y navegación adaptada al dispositivo.
colors:
  bg: '#ffffff'
  tint: '#fef4ef'
  tint2: '#fce9df'
  tint3: '#f9dccb'
  line: '#f3e4db'
  line2: '#ead5c9'
  salmon: '#ff8b52'
  salmon-deep: '#e96f33'
  salmon-ink: '#b44e1b'
  ink: '#2e2320'
  ink2: '#5c4a41'
  muted: '#78645d'
  crit: '#b4382b'
  crit-bg: '#fbebe8'
  ok: '#237a55'
  ok-bg: '#e9f6f0'
  warn: '#8a5511'
  warn-bg: '#fcf2e2'
  info: '#35669f'
  info-bg: '#ecf2fa'
  mobile-ground: '#faf8f6'
typography:
  headline:
    fontFamily: 'Inter, Arial, sans-serif'
    fontSize: '20px'
    fontWeight: 700
    lineHeight: '28px'
    letterSpacing: '-0.025em'
  title:
    fontFamily: 'Inter, Arial, sans-serif'
    fontSize: '17px'
    fontWeight: 700
    letterSpacing: '-0.025em'
  body:
    fontFamily: 'Inter, Arial, sans-serif'
    fontSize: '14px'
    fontWeight: 400
    lineHeight: '20px'
  label:
    fontFamily: 'Inter, Arial, sans-serif'
    fontSize: '12px'
    fontWeight: 600
    lineHeight: '16px'
  table:
    fontFamily: 'Inter, Arial, sans-serif'
    fontSize: '13px'
  table-heading:
    fontFamily: 'JetBrains Mono, monospace'
    fontSize: '10px'
    fontWeight: 600
    letterSpacing: '0.05em'
  dock-label:
    fontFamily: 'Inter, Arial, sans-serif'
    fontSize: '11px'
    fontWeight: 600
    lineHeight: '16px'
rounded:
  lg: '8px'
  xl: '12px'
  panel: '14px'
  2xl: '16px'
  full: '9999px'
spacing:
  1: '4px'
  2: '8px'
  3: '12px'
  4: '16px'
  5: '20px'
  6: '24px'
  7: '28px'
components:
  button-primary:
    backgroundColor: '{colors.salmon}'
    textColor: '{colors.ink}'
    rounded: '{rounded.lg}'
    padding: '10px 16px'
  button-primary-hover:
    backgroundColor: '{colors.salmon-deep}'
  button-secondary:
    backgroundColor: '{colors.bg}'
    textColor: '{colors.salmon-ink}'
    rounded: '{rounded.lg}'
    padding: '10px 16px'
  button-danger:
    backgroundColor: '{colors.crit}'
    textColor: '#ffffff'
    rounded: '{rounded.lg}'
    padding: '10px 16px'
  input:
    backgroundColor: '{colors.bg}'
    textColor: '{colors.ink}'
    rounded: '{rounded.lg}'
    padding: '10px 12px'
  panel:
    backgroundColor: '{colors.bg}'
    rounded: '{rounded.panel}'
    padding: '20px'
  badge:
    typography: '{typography.label}'
    rounded: '{rounded.full}'
    padding: '4px 10px'
  mobile-dock:
    backgroundColor: '{colors.bg}'
    rounded: '{rounded.2xl}'
    padding: '8px'
  mobile-dock-item:
    typography: '{typography.dock-label}'
    rounded: '{rounded.xl}'
    padding: '8px 4px'
  mobile-module:
    rounded: '{rounded.panel}'
    padding: '16px'
  featured-module:
    backgroundColor: '{colors.salmon}'
    textColor: '{colors.ink}'
    rounded: '{rounded.2xl}'
    padding: '20px'
---

# Design System: MoiFood

## Overview

**Creative North Star: "MoiFood"**

MoiFood conserva su identidad naranja, su logo y su lenguaje de gestión interna
en español de Chile. Las vistas priorizan tareas, permisos y lectura clara: una
cabecera compacta, superficies claras y controles compartidos acompañan la misma
información en móvil y escritorio. La referencia móvil aportada por el usuario
orienta la composición; la marca y los datos proceden de MoiFood.

Guía obligatoria para cualquier vista o componente nuevo del frontend. Su objetivo
es que todas las pantallas se vean y se comporten igual, sin temas por módulo ni
estilos duplicados. Si un cambio necesita salirse de estas reglas, primero se
actualiza este archivo en el mismo PR y se justifica en la descripción.

**Key Characteristics:**

- Identidad naranja MoiFood y tema claro compartido por todos los módulos.
- Densidad operativa con bordes suaves, texto legible y foco visible.
- Navegación inferior en móvil y menú lateral en escritorio.
- Las fichas y tablas conservan metadatos, estados y operaciones.

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

## Colors

Los valores del frontmatter son normativos; esta sección explica sus usos.
La familia primaria reúne `salmon`, `salmon-deep`, `salmon-ink` y sus tintes.
Los neutros agrupan superficies, bordes y tintas; los estados mantienen sus
parejas semánticas existentes.

Todos los colores se definen como tokens en `@theme static` de `globals.css` y se
usan con las utilidades de Tailwind (`bg-tint`, `text-ink2`, `border-line`…).
**Nunca** se escriben hexadecimales, `rgb()` ni colores arbitrarios
(`text-[#…]`) en los componentes. Un color nuevo se agrega primero como token.

| Token              | Uso                                                                             |
| ------------------ | ------------------------------------------------------------------------------- |
| `bg`               | Superficie de tarjetas, paneles, cabecera, menú, inputs y diálogos              |
| `tint`             | Fondo del escritorio, hover de filas y botones secundarios, encabezado de tabla |
| `tint2`            | Enlace activo del menú, badges neutros de marca, avisos informativos            |
| `mobile-ground`    | Fondo de página y contenido por debajo de 1024 px                               |
| `tint3`            | Selección de texto                                                              |
| `line`             | Bordes de tarjetas, paneles, separadores y filas                                |
| `line2`            | Bordes de inputs y botones secundarios                                          |
| `salmon`           | Fondo del botón primario                                                        |
| `salmon-deep`      | Hover del botón primario y «Food» en la marca                                   |
| `salmon-ink`       | Texto de botones secundarios y enlaces, contorno de foco, rol en la cuenta      |
| `ink`              | Texto principal y texto sobre el botón primario                                 |
| `ink2`             | Texto secundario, etiquetas y descripciones                                     |
| `muted`            | Metadatos, placeholders, IDs y textos de menor jerarquía                        |
| `crit` / `crit-bg` | Errores, estado «Desactivado» y acciones destructivas                           |
| `ok` / `ok-bg`     | Estado «Activo» y confirmaciones                                                |
| `warn` / `warn-bg` | Advertencias y plazos próximos a vencer                                         |
| `info` / `info-bg` | Información neutra (por ejemplo, el rol Contador)                               |

El token global `warn` usa el valor oscuro registrado para cumplir contraste AA sobre `warn-bg`. Afecta a todas las vistas que usan este token.

Reglas de color:

- El botón primario lleva **texto `ink` sobre `salmon`**. El texto blanco sobre
  salmón no alcanza el contraste mínimo.
- Los colores de estado (`crit`, `ok`, `warn`, `info`) se usan siempre en pareja:
  texto con el color fuerte sobre su fondo `-bg`.
- El color nunca es la única señal: los estados llevan texto («Activo»,
  «Desactivado») y, si aplica, un punto o ícono `aria-hidden`.

**The Contraste de Marca Rule.** El texto sobre `salmon` es `ink`, tanto en el botón primario como en la tarjeta de tarea.

## Typography

Las fuentes se cargan **una sola vez** en `src/app/layout.tsx` con `next/font`:
**Inter** (`font-sans`, por defecto) y **JetBrains Mono** (`font-mono`).

La escala permitida es la siguiente; no se agregan tamaños arbitrarios fuera de ella.

| Tamaño | Clase                                  | Uso                                                                           |
| ------ | -------------------------------------- | ----------------------------------------------------------------------------- |
| 10 px  | `text-[10px]` + `font-mono uppercase`  | Leyenda de marca, encabezados de tabla                                        |
| 11 px  | `text-[11px]`                          | Metadatos de tabla y etiquetas de la barra móvil                              |
| 12 px  | `text-xs`                              | Etiquetas de formulario, badges, ayudas y descripciones de tabla              |
| 13 px  | `text-[13px]`                          | Cuerpo de tablas y correo de la cuenta en el menú                             |
| 14 px  | `text-sm`                              | Botones, menú lateral, introducciones y títulos de panel; inputs desde 640 px |
| 16 px  | `text-base`                            | Texto base, marca e inputs por debajo de 640 px                               |
| 17 px  | `text-[17px] font-bold tracking-tight` | Título de la vista en la cabecera (`ApplicationHeading`)                      |
| 18 px  | `text-lg font-bold`                    | Título de diálogos y del login                                                |
| 20 px  | `text-xl font-bold`                    | Título principal dentro de una tarjeta de bienvenida o recuperación           |

Pesos: `font-normal` en texto e inputs, `font-medium` para resaltar dentro de una
celda, `font-semibold` en etiquetas, botones y badges, `font-bold` en títulos y
`font-extrabold` solo en la marca.

`font-mono` se reserva para datos técnicos: encabezados de tabla, fechas y horas,
códigos de operación (`USER_LOGIN`), IDs de registro y la leyenda «Gestión
interna». No se usa en párrafos ni en botones.

Los inputs conservan 20 px de interlineado al cambiar de 16 a 14 px. Los accesos rápidos usan 12 px antes de 640 px y 14 px desde ese ancho. Las descripciones de la tarjeta de tarea usan 14 px con interlineado de 24 px.

## Layout

- Toda vista autenticada vive en `src/app/(authenticated)/`. Su
  `layout.tsx` valida la sesión en servidor y envuelve el contenido en
  `ApplicationShell`. Desde 1024 px conserva el menú lateral de 248 px,
  la marca y los datos de la cuenta; la cabecera contiene el título y «Mi sesión».
- **Ninguna página ni `loading.tsx` vuelve a envolver su contenido en
  `ApplicationShell`**: duplicaría el menú.
- Una vista nueva se registra en `src/lib/navigation.ts`:
  `getNavigationItems()` define el menú según rol y `getNavigationView()` el
  título de la cabecera. La página no dibuja su propio `<h1>`; lo pone
  `ApplicationHeading`.
- Los errores usan `app/(authenticated)/error.tsx` y los fallos de sesión
  `SessionUnavailable` / `SessionRecovery`. No se crean pantallas de error propias
  por módulo.
- **Móvil y tablet:** por debajo de 1024 px, el lateral desaparece y la cabecera
  sticky reúne logo de 36 px, título y control de sesión con icono y nombre
  accesible «Mi sesión». Tiene altura mínima de 64 px. Correo y rol se consultan
  al abrir la sesión. En escritorio, la cabecera es estática.
- El diseño se verifica a 360, 390, 768 y 1440 px sin scroll horizontal de página.
  Las tablas que se mantienen se desplazan dentro de su región enfocable.

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

### Espaciado y composición móvil

`main` separa bloques con 20 px. Su padding horizontal es de 16 px, de 20 px
desde 640 px y de 28 px desde 1024 px; el vertical pasa de 20 a 24 px desde
640 px. Los paneles usan 20 px y el inicio tiene ancho máximo de 64 rem.
Dentro de formularios se conservan 16 px entre campos y 8 px entre etiqueta y
control.

La barra inferior ocupa como máximo cinco plazas según el rol. Si hay más
módulos, cuatro enlaces y Más ocupan esas plazas. Más conserva toda la
navegación autorizada en un diálogo nativo. La barra tiene 8 px de padding,
z-index 30 y separación exterior mínima de 12 px; los laterales respetan el
mayor valor entre 12 px y el inset seguro. Abajo se suman 12 px al inset.
El viewport declara `viewport-fit: cover`.

Por debajo de 1024 px, el contenido reserva
`calc(7rem + env(safe-area-inset-bottom, 0px))`. El documento usa scroll-padding
superior de 6 rem e inferior de
`calc(8rem + env(safe-area-inset-bottom, 0px))` para que la barra no cubra el
contenido ni el foco. El fondo es `mobile-ground`; el escritorio conserva `tint`.

### Filtros progresivos y fichas

En Usuarios la búsqueda siempre está visible. Más filtros expande rol, estado
y local por debajo de 1024 px; Menos filtros los vuelve a cerrar. Los valores
se conservan y el botón muestra cuántos filtros adicionales están activos.
Desde 1024 px todos los campos permanecen visibles. Actualizar y Crear usuario
siguen disponibles.

Usuarios y Locales usan fichas `<ul>` / `<li>` / `<article>` por debajo de
1024 px, con separadores y padding de 16 px. Usuarios muestra nombre, correo,
estado, rol, local y acciones; Locales muestra nombre, ciudad, dirección, estado
y acciones. Desde 1024 px, ambos conservan sus tablas. Cada vista reutiliza
las mismas funciones de acciones y operaciones en ambos formatos y mantiene
el conteo visible. Los demás listados conservan su tabla desplazable o sus
tarjetas de consulta. Nunca se oculta el overflow de toda la página.

## Elevation & Depth

Las superficies de contenido se separan con `border-line`. Las sombras se
reservan para capas flotantes: `shadow-lg` en Mi sesión, `shadow-xl` en diálogos
y `shadow-dock` en la barra inferior. Esta última usa
`0 8px 32px -8px #2e232030`; el sidecar registra también los valores resueltos
de Tailwind para las otras capas. El fondo de los diálogos usa `ink` al 35 %.

**The Bordes Antes que Sombras Rule.** El borde delimita el contenido; la sombra
comunica una capa flotante como la barra, el menú de sesión o un diálogo.

Las transiciones de color compartidas usan los valores de Tailwind: 150 ms y
`cubic-bezier(0.4, 0, 0.2, 1)`. La tarjeta destacada cambia de fondo en hover.

## Shapes

- **Radios:** `rounded-lg` (8 px) en inputs, botones y avisos simples;
  `rounded-xl` (12 px) en marca, avisos destacados, control de barra y Mi sesión;
  radio de 14 px en tarjetas, paneles, iconos de accesos y módulos de Más;
  `rounded-2xl` (16 px) en diálogos, login, barra y tarjeta de tarea;
  `rounded-full` en badges.
- Los diálogos de operaciones se centran, mantienen 16 px libres alrededor,
  ancho máximo de 32 rem y alto máximo de `calc(100dvh - 2rem)` con scroll
  interno. Su padding pasa de 16 a 24 px desde 640 px.
- El diálogo Más se ancla abajo, con esquinas superiores redondeadas, ancho
  completo hasta 36 rem, el mismo alto máximo, scroll interno, overscroll
  contenido y padding inferior según el área segura.

## Components

Usar siempre las constantes de `src/components/ui/styles.ts`:

| Elemento          | Constante                                                             | Notas                                                                                      |
| ----------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Input y select    | `inputClass`                                                          | Mínimo 44 px; texto de 16 px en móvil y 14 px desde 640 px; foco `salmon-ink`              |
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
- **Diálogos de operaciones:** `<dialog>` nativo con `showModal()`, `aria-label` igual al título,
  botón de cierre «×» con `aria-label="Cerrar ventana"` y fondo
  `backdrop:bg-ink/35`. Escape cierra el diálogo salvo que haya una operación en
  curso.
- **Avisos en línea:** error `rounded-lg border border-crit/20 bg-crit-bg px-3.5 py-3 text-sm text-crit`;
  información `rounded-xl border border-line2 bg-tint2 p-4 text-sm text-ink2`.
- **Íconos:** no se usan emojis en la interfaz. Si se agregan íconos, se definen
  en un único componente compartido y llevan `aria-hidden="true"` cuando son
  decorativos.

### Inicio y navegación móvil

- `featuredModuleClass` hace de la tarjeta de tarea completa un único enlace
  táctil, con nombre accesible de la acción, título, explicación y flecha.
  Usa fondo `salmon`, texto `ink`, padding de 20 px (24 px desde 640 px), hover
  `salmon-deep` y foco `ink` separado 4 px. Su ruta depende del rol.
- `homeModuleClass` dispone accesos en tres columnas, cuatro desde 640 px.
  Cada enlace tiene altura mínima de 80 px, icono de 20 px dentro de un módulo
  de 48 px, radio de 14 px, borde `line` y fondo `bg`, seguido del nombre.
  El hover del módulo usa `tint2` y borde `line2`.
- `mobileDockItemClass` dispone icono y etiqueta en columna, con altura mínima
  de 56 px y ancho mínimo de 44 px. La página activa usa `tint2`, `salmon-ink`
  y `aria-current="page"`; el resto usa `ink2` y hover `tint`. Los nombres
  visibles cortos conservan el nombre completo accesible.
- Más es un botón con `aria-expanded`, `aria-controls` y `aria-haspopup="dialog"`.
  Abre un `<dialog>` nativo con `showModal()` y título accesible Todos los
  módulos. El cierre y Escape devuelven el foco al disparador; elegir destino
  cierra el menú. `mobileModuleClass` organiza sus enlaces en dos columnas,
  con altura mínima de 96 px, icono, nombre completo y colores activos comunes.
- Los destinos y accesos rápidos proceden de `navigation.ts` y de la sesión;
  no se inventan indicadores ni se muestra información de otros usuarios.
- `Icon.tsx` centraliza SVG de 20 px y trazo de 2 px con `aria-hidden="true"`.
  Los controles conservan etiqueta visible o nombre accesible.
- Mi sesión usa `<details>`: cierra al pulsar fuera o Escape; Escape devuelve
  el foco al disparador. La navegación lateral conserva texto de 14 px,
  objetivos de 44 px y los mismos colores activos.

### Tarjetas de consulta y alertas

Se conservan tarjetas semánticas `<ul>` en alertas y consultas personales de solo
lectura: sección con título accesible, `tablePanelClass`, separadores `line`,
conteo y controles compartidos. Cada tarjeta agrupa sus metadatos y acciones.
Las vistas administrativas conservan tablas en escritorio; Usuarios y Locales
usan las fichas móviles descritas en Layout.

### Accesibilidad

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

### Textos de la interfaz

- Español de Chile, tuteo y frases en mayúscula inicial (no Title Case).
- Botones con verbo en infinitivo y objeto: «Guardar usuario», «Aplicar filtros».
- Estados de carga con puntos suspensivos tipográficos: «Cargando…», «Creando…».
- Fechas y horas en hora de Chile, indicándolo cuando sea relevante.
- Los mensajes de error explican qué hacer a continuación y nunca muestran
  mensajes internos del backend.

## Do's and Don'ts

### Do:

- Do reutilizar `globals.css`, `ui/styles.ts` y `ApplicationShell` como fuentes compartidas.
- Do mantener objetivos táctiles de al menos 44 px, foco visible y contraste AA.
- Do conservar permisos, metadatos, estados, acciones y conteos al alternar fichas y tablas.
- Do conservar los valores y el conteo de filtros adicionales al cerrar Más filtros.
- Do reservar espacio y scroll-padding para la barra inferior y las áreas seguras.
- Do revisar carga, vacío, error, foco por teclado y reflujo en móvil y escritorio antes del PR.

### Don't:

- Don't crear temas por módulo, fuentes duplicadas ni variantes oscuras sin una decisión de diseño.
- Don't escribir colores arbitrarios en componentes; definir primero los tokens.
- Don't usar texto blanco sobre salmón ni comunicar estados solo mediante color.
- Don't duplicar `ApplicationShell` ni el `h1` compartido dentro de una página o su loading.
- Don't ocultar el overflow de toda la página ni cubrir contenido con la barra inferior.
- Don't inventar saldos, indicadores o información ajena para llenar el inicio.

### Checklist antes de abrir un PR con cambios visuales

- [ ] No hay colores arbitrarios en componentes, tamaños fuera de la escala ni archivos CSS nuevos.
- [ ] Controles, tablas, badges y paneles usan las constantes de `ui/styles.ts`.
- [ ] La vista nueva está registrada en `src/lib/navigation.ts` y no vuelve a
      envolver `ApplicationShell`.
- [ ] Se revisó con playwright-cli en 1440×900 y 390×844: mismos estilos
      calculados que las vistas existentes, foco visible al navegar con Tab y sin
      scroll horizontal.
- [ ] Se probaron los estados de carga, vacío y error.
- [ ] Si se cambió una regla de este documento, `DESIGN.md` se actualizó en el
      mismo PR.

### Deuda conocida preservada

Desvíos existentes que deben corregirse cuando se toque el archivo:

- `SessionUnavailable.tsx`: muestra la marca sin el logo, a diferencia del login
  y del menú.

La leyenda de marca de 10 px describe la marca existente; no autoriza crear
eyebrows o kickers decorativos en otras superficies.
