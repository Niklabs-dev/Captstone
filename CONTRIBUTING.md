# Guía de contribución — MoiFood

**SPRINT-1-T27 · Guía de contribución (CONTRIBUTING.md)**
**Responsable:** Luis Hernández (Scrum Master · Documentación y Pruebas)

Esta guía explica, paso a paso, cómo aportar al repositorio `Niklabs-dev/Captstone` para que todo cambio llegue a `main` revisado, probado y trazable con su tarea de Notion.

Las reglas técnicas completas (estilo de código, Swagger, migraciones y calidad) están en [`AGENTS.md`](Fase%202/Evidencias%20Proyecto/Evidencias%20de%20sistema%20Aplicaci%C3%B3n/AGENTS.md). Los criterios para dar una tarea por terminada están en la [Definition of Done](Fase%202/Evidencias%20Proyecto/Evidencias%20de%20documentaci%C3%B3n/Sprint%201/T23-definition-of-done.md).

## 1. Estructura del repositorio

```
Captstone/
├── Fase 1/                         # Entregables académicos de Fase 1
├── Fase 2/
│   ├── Evidencias Grupales/        # Guías y planillas de evaluación
│   ├── Evidencias Individuales/
│   └── Evidencias Proyecto/
│       ├── Base de datos/
│       ├── Evidencias de documentación/   # Documentación Scrum por sprint
│       └── Evidencias de sistema Aplicación/
│           ├── backend/            # API NestJS
│           ├── frontend/           # Next.js
│           ├── docker-compose.yml
│           └── AGENTS.md           # Reglas técnicas del equipo
├── Fase 3/
└── CONTRIBUTING.md                 # Esta guía
```

## 2. Flujo de una tarea

```
Notion "En curso" → rama desde main → commits → PR → revisión → merge → ID commit en Notion → "Hecho"
```

**Regla de oro:** una tarea = una rama = un Pull Request.

### Paso a paso (PowerShell o terminal de VS Code)

1. **Mover la tarea a "En curso"** en el tablero de Notion.
2. **Actualizar `main`** en tu copia local:
   ```powershell
   git switch main
   git pull
   ```
3. **Crear la rama de la tarea:**
   ```powershell
   git switch -c feat/sprint-1-t08-crud-usuarios
   ```
4. **Trabajar y hacer commits** (ver sección 4):
   ```powershell
   git status
   git add <archivos>
   git commit -m "feat: agrega endpoints de gestión de usuarios (SPRINT-1-T08)"
   ```
5. **Verificar la calidad** antes de subir (en `backend/` o `frontend/`, según corresponda):
   ```powershell
   npm run lint
   npm run format:check
   npm run build
   npm run test
   ```
6. **Traer lo nuevo de `main`** a tu rama, para que el PR no quede desactualizado:
   ```powershell
   git switch main
   git pull
   git switch feat/sprint-1-t08-crud-usuarios
   git merge main
   ```
7. **Subir la rama:**
   ```powershell
   git push -u origin feat/sprint-1-t08-crud-usuarios
   ```
8. **Abrir el Pull Request** en GitHub hacia `main` y mover la tarea a **"En revisión"**.
9. **Después del merge**, copiar el hash del commit al campo **ID commit** de Notion, escribir un comentario breve y mover la tarea a **"Hecho"**.

## 3. Ramas

| Regla | Ejemplo |
|---|---|
| Formato `<tipo>/sprint-<N>-t<NN>-<descripcion-corta>` | `feat/sprint-1-t07-guard-roles` |
| Corrección de una tarea ya integrada | `fix/sprint-1-t09-build-login` |
| Documentación | `docs/sprint-1-documentacion` |
| Nunca trabajar directo en `main` | — |
| Borrar la rama después del merge | — |

**Excepción vigente:** la documentación Scrum de un sprint puede ir en una sola rama y un solo PR, siempre que **cada tarea tenga su propio commit** (así cada una tiene su ID commit). Aprobada por el Product Owner el 07-10-2026.

## 4. Commits

Formato Conventional Commits, **en español**, con el ID de la tarea al final:

```
<tipo>: <descripción en minúscula> (SPRINT-N-TNN)
```

| Tipo | Cuándo usarlo | Ejemplo |
|---|---|---|
| `feat` | Funcionalidad nueva | `feat: agrega guards y decoradores de autorización por rol y local (SPRINT-1-T07)` |
| `fix` | Corrección de un error | `fix: la ruta raíz de la API indica que el sistema está funcionando` |
| `docs` | Solo documentación | `docs: agrega plan de pruebas del sprint 1 (SPRINT-1-T25)` |
| `test` | Agregar o corregir tests | `test: usa upsert de tipos de documento en tests de integración (SPRINT-1-T06)` |
| `refactor` | Cambio interno sin cambiar el comportamiento | `refactor: extrae validación de RUT a utilidad (SPRINT-1-T08)` |
| `chore` | Configuración y dependencias | `chore: configura ESLint, Prettier y variables de entorno (SPRINT-1-T02)` |

Commits **atómicos**: un commit por cambio lógico. Evitar mensajes como "cambios", "avance" o "agregando las vistas".

## 5. Pull Requests

- **Un PR por tarea**; no mezclar tareas.
- **Título** con el mismo formato de los commits.
- **Revisión obligatoria** por un integrante distinto del autor.
- No se integra si fallan lint, format, build o tests.

Plantilla de descripción:

```markdown
## Tarea
SPRINT-N-TNN — <nombre de la tarea en Notion>

## Qué se hizo
-

## Cómo se probó
- [ ] npm run lint / format:check / build
- [ ] npm run test
- [ ] docker compose up --build

## Notas para quien revisa
-
```

## 6. Estados del tablero (Notion)

| Estado | Significado |
|---|---|
| Por hacer | Planificada, sin iniciar |
| En curso | Alguien trabaja en ella y tiene rama |
| En revisión | PR abierto esperando revisión |
| Bloqueado | No puede avanzar; explicar el motivo en "Comentación en caso de Bloqueo" |
| Hecho | Integrada en `main`, cumple la DoD y tiene ID commit |

## 7. Reglas que no se negocian

- **Nunca subir el `.env`**; las variables nuevas van en `.env.example`.
- **Nunca editar una migración ya aplicada**; los cambios de esquema van en una migración nueva.
- Todo endpoint nuevo se documenta en Swagger en el mismo PR.
- No dejar en el código datos de prueba, contraseñas fijas ni textos de desarrollo.
- Si integras una tarea trabajada por otro integrante, indícalo en el campo **Comentario** de Notion.

## 8. Errores comunes

| Situación | Qué hacer |
|---|---|
| `git status` muestra cambios antes de `git pull` | Hacer commit de esos cambios o consultar al equipo antes de seguir |
| Aparece `>>` en PowerShell | El comando quedó incompleto: presionar `Ctrl + C` y escribirlo de nuevo |
| `git push` responde 403 | No tienes permiso de escritura; pedirlo al dueño del repositorio |
| El PR muestra conflictos | Repetir el paso 6 (traer `main` a la rama) y resolverlos en VS Code |
| Prisma sugiere actualizar a una versión `rc` o mayor | No actualizar; los cambios de versión se deciden en equipo |
