# AGENTS.md — Capstone Subway (Sistema de Gestión Interna "Moi-food")

## Resumen del proyecto

Proyecto de Portafolio de Título (Capstone), Ingeniería en Informática — Duoc UC, Sede Melipilla.

Sistema web de gestión interna para el franquiciado de Subway **"Moi-food"** (3 locales: dos en Melipilla y uno en Calera). Hoy la documentación laboral, el reparto de propinas, el cierre de caja y el inventario se manejan de forma manual; el sistema los centraliza con trazabilidad completa y cumplimiento del Código del Trabajo (art. 9 bis y 64) y la Ley N°21.719 de protección de datos.

**Módulos:** Núcleo (usuarios, roles, auditoría) · Gestor Documental (archivos con hash SHA-256 y versionado) · Propinas · Ventas y Caja · Inventario · Portal del Trabajador.

**Stack:** TypeScript en todo el stack — backend **NestJS** (monolito modular, API REST, JWT), frontend **Next.js** (App Router, Tailwind CSS), base de datos **PostgreSQL**. Todo corre en contenedores **Docker** y se despliega con Coolify en el servidor de la empresa.

**Metodología:** Scrum con sprints de 2 semanas. Equipo: Lucas Flores (Frontend), Nicolás Jiménez (Product Owner / Backend / BD), Luis Hernández (Scrum Master / Documentación y Pruebas). Líder técnico: Carlos Quintanilla.

**Gestión de tareas:** tablero "Tablero de Tareas — Capstone Subway" en Notion (página `Capstone-Subway`), con la "Definición de Terminado (DoD)" asociada.

## Estructura del repositorio

```
Evidencias de sistema Aplicación/
├── backend/            # API NestJS 12 (ESM, TypeScript estricto, Vitest)
├── frontend/           # Next.js 16 (App Router, React 19, Tailwind 4, src/)
├── docker-compose.yml  # PostgreSQL + backend + frontend
└── AGENTS.md           # este archivo
```

Nota: `frontend/AGENTS.md` es generado y mantenido por Next.js; leerlo antes de modificar el frontend y no eliminarlo.

## Forma de escritura de código

- **TypeScript estricto** en ambos proyectos: **prohibido `any`** (usar `unknown` o tipos explícitos) y **`void` solo cuando sea estrictamente necesario** —firmas que lo exigen, como los hooks de ciclo de vida de NestJS (ej. la conexión a la base de datos)—; todo lo demás va tipado explícitamente.
- **Identificadores en inglés** (variables, funciones, clases, archivos); **comentarios, documentación y mensajes de commit en español**.
- **Backend NestJS:** arquitectura modular obligatoria — cada módulo con su controller, service y module; la lógica de negocio va en los servicios; configuración con `@nestjs/config` (nunca `process.env` directo); sin secretos en el código.
- **Frontend Next.js:** Server Components por defecto (`'use client'` solo cuando haya interactividad); rutas en `src/app/`, componentes en `src/components/`; estilos con Tailwind, sin CSS personalizado salvo necesidad.
- **ESLint y Prettier son parte de la escritura**, no un paso posterior: el código se escribe ya formateado y sin warnings (`npm run format` antes de commitear).
- **Tests junto al código:** todo código nuevo de lógica lleva sus tests en el mismo PR (no se dejan "para después"). Los tests de integración del backend corren contra PostgreSQL real y **revierten su transacción** (patrón `withinRollback` de `test/database.integration.spec.ts`), así no dejan datos residuales.
- **Migraciones Prisma seguras:**
  - Nunca editar ni renombrar una migración ya aplicada o commiteada: todo cambio de schema va en una **migración nueva**.
  - El timestamp de la migración debe ser **posterior a la última existente** (Prisma las aplica en orden alfabético; una migración con timestamp anterior rompe los despliegues desde cero).
  - Antes de commitear, verificar con `migrate deploy` sobre un **volumen limpio**: `docker compose down -v && docker compose up --build -d db migrate backend`.
- **Calidad obligatoria antes de commitear** (debe pasar sin errores):
  - `npm run lint` y `npm run format:check` (ESLint + Prettier en ambos proyectos)
  - `npm run build` en el proyecto afectado
  - `npm run test` en backend si se tocó lógica
  - `docker compose up` cuando el cambio afecte infraestructura
- **Archivos generados fuera de git:** `dist/`, `node_modules/`, `src/generated/` (cliente Prisma) y `*.tsbuildinfo` no se commitean; deben estar en `.gitignore`.
- **Variables de entorno:** toda variable nueva se documenta en el `.env.example` correspondiente; los `.env` reales nunca se commitean.
- **Commits atómicos:** un commit por cambio lógico, estilo Conventional Commits en español, referenciando la tarea del tablero, ej.: `feat: agrega login con JWT (SPRINT-1-T04)`.

## Flujo de trabajo para cada tarea

Las tareas viven en el tablero de Notion con estados: `Por hacer` → `En curso` → `En revisión` → `Hecho` (o `Bloqueado`).

**Regla de oro: una tarea = una rama = un Pull Request.** No se mezclan varias tareas en un mismo PR ni se trabajan dos tareas en la misma rama; si durante el trabajo surge algo fuera del alcance de la tarea, se crea una tarea nueva en el tablero.

1. **Tomar la tarea:** pasar la tarea a **En curso** en el tablero de Notion antes de empezar.
2. **Crear la rama:** `git checkout -b feat/<ID-tarea>-descripcion-corta` desde `main` (ej.: `feat/sprint-1-t04-login-jwt`).
3. **Implementar y verificar:** cumplir los criterios de calidad de arriba y la DoD del tablero.
4. **Commitear:** uno o más commits limpios referenciando el ID de la tarea.
5. **Registrar en Notion:** al terminar, anotar en la tarea el **ID de commit** (hash) y un **comentario breve** de lo completado.
6. **Enviar a revisión:** si no hay problemas, pasar la tarea a **En revisión**, hacer push de la rama y abrir un **Pull Request** para que sea revisado.
   - Si hay problemas que impiden avanzar, dejar la tarea en **Bloqueado** con un comentario que explique el impedimento.
7. **Cerrar la tarea:** solo cuando **el usuario confirme la revisión**, pasar la tarea a **Hecho**. Nunca marcar como hecha una tarea sin esa confirmación.

## Comandos útiles

```bash
# Desarrollo local
cd backend && npm install && npm run start:dev   # API en http://localhost:3001
cd frontend && npm install && npm run dev         # Web en http://localhost:3000

# Sistema completo con Docker (sin pasos manuales)
docker compose up --build                         # db + backend + frontend

# Calidad
npm run lint && npm run format:check              # en backend/ y frontend/
npm run test                                      # tests backend (Vitest)
```
