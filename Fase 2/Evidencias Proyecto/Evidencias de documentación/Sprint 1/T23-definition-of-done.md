# Definition of Done (DoD) — MoiFood

**SPRINT-1-T23 · Definition of Done oficial del equipo**
**Responsable:** Luis Hernández (Scrum Master)
**Versión:** 1.0 · **Vigente desde:** Sprint 1 · **Acordada por:** Nicolás Jiménez, Lucas Flores y Luis Hernández

La Definition of Done es el acuerdo del equipo sobre cuándo un trabajo está realmente terminado. Una tarea solo pasa a **Hecho** en Notion cuando cumple **todos** los puntos que le aplican. Este documento formaliza las reglas de calidad de `AGENTS.md` como lista de verificación.

## 1. Código

- [ ] `npm run lint` sin errores ni warnings (ESLint).
- [ ] `npm run format:check` sin errores (Prettier).
- [ ] `npm run build` compila sin errores en el proyecto afectado.
- [ ] TypeScript estricto: sin `any` (se usa `unknown` o tipos explícitos).
- [ ] Identificadores en inglés; comentarios y documentación en español.
- [ ] Sin datos de prueba, contraseñas fijas ni textos de desarrollo en el código final.
- [ ] Sin secretos en el código; configuración leída con `@nestjs/config`.

## 2. Pruebas

- [ ] Todo código nuevo de lógica tiene sus tests en el mismo PR.
- [ ] `npm run test` en verde en el backend.
- [ ] Los tests de integración corren contra PostgreSQL real y revierten su transacción (patrón `withinRollback`), sin dejar datos residuales.

## 3. Base de datos

- [ ] Todo cambio de esquema va en una **migración nueva** de Prisma; nunca se edita una migración ya aplicada.
- [ ] El timestamp de la migración es posterior al de la última existente.
- [ ] La migración se verifica sobre un volumen limpio: `docker compose down -v && docker compose up --build -d db migrate backend`.
- [ ] El seed sigue siendo idempotente (se puede ejecutar varias veces sin duplicar datos).
- [ ] `backend/docs/modelo-datos.md` actualizado si cambió el modelo.

## 4. API y documentación

- [ ] Todo endpoint nuevo o modificado está documentado en Swagger (`/api/docs`) en el mismo PR: `@ApiTags`, `@ApiOperation`, respuestas de éxito y error tipadas y `@ApiBearerAuth` si está protegido.
- [ ] Variables de entorno nuevas documentadas en `.env.example`; el `.env` real nunca se sube.
- [ ] README actualizado si cambia la forma de levantar o usar el sistema.

## 5. Integración

- [ ] La tarea vive en su propia rama `feat/sprint-N-tNN-descripcion`, creada desde `main` y actualizada con `main` antes del PR.
- [ ] Commits atómicos en español, formato Conventional Commits, con el ID de la tarea.
- [ ] Pull Request revisado y aprobado por un integrante distinto del autor.
- [ ] El sistema completo levanta con `docker compose up --build` cuando el cambio afecta infraestructura.

## 6. Trazabilidad en el tablero

- [ ] Campo **ID commit** con el hash del commit integrado.
- [ ] Campo **Comentario** con un resumen de lo realizado y cómo se verificó.
- [ ] La tarea pasa a **Hecho** solo después de que la revisión se confirme.

## DoD a nivel de historia de usuario

Una historia (por ejemplo, E1-H1) está terminada cuando:

- [ ] Todas sus tareas están en **Hecho**.
- [ ] Todos sus criterios de aceptación pasaron el plan de pruebas ([T25](T25-plan-de-pruebas.md)), con evidencia en el informe de resultados.
- [ ] Fue demostrada y aceptada por el Product Owner en el Sprint Review.

## DoD para tareas de documentación

- [ ] El documento está en la carpeta del sprint correspondiente y enlazado desde su `README.md`.
- [ ] Encabezado con el ID y el nombre de la tarea del tablero.
- [ ] Integrado mediante PR, con un commit propio cuyo hash queda en el campo **ID commit** de Notion.

## Excepciones acordadas

| Excepción | Motivo | Aprobada por |
|---|---|---|
| La documentación Scrum del Sprint 1 (T22–T31) se integra en una sola rama y un solo PR, con **un commit por tarea** | Reducir tiempo de revisión al cierre del sprint sin perder la trazabilidad por tarea | Nicolás Jiménez (Product Owner), 07-10-2026 |
