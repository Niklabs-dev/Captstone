# Registro de Daily Standups — Sprint 1

**SPRINT-1-T24 · Registro de Daily Standups del Sprint 1**
**Responsable:** Luis Hernández (Scrum Master)

**Formato:** de lunes a viernes, máximo 15 minutos, facilitado por el Scrum Master. Cada integrante responde tres preguntas: ¿qué hice desde el último daily?, ¿qué haré hasta el próximo?, ¿tengo algún bloqueo?

**Fuentes del registro:** notas del Scrum Master, contrastadas con el tablero de Notion y el historial de commits y Pull Requests del repositorio.

## Resumen

| # | Fecha | Modalidad | Asistentes | Evidencia | Hitos del día |
|---|---|---|---|---|---|
| 1 | Lun 28-09 | Presencial | Nicolás, Luis (Lucas no asistió) | Registro del Scrum Master | Inicio de los dailies; base técnica y modelo de datos ya integrados |
| 2 | Mar 29-09 | Presencial | Nicolás, Luis (Lucas no asistió) | Registro del Scrum Master | Se integran T05, T06, T21 y T07 (PR #4 a #7) |
| 3 | Mié 30-09 | Presencial | Nicolás, Lucas, Luis | Registro del Scrum Master | Inicio del CRUD de usuarios y del interceptor de auditoría |
| 4 | Jue 01-10 | Teams | Nicolás, Lucas, Luis | **Grabación en Teams** (única sesión grabada del sprint; enlace enviado al profesor) | Sin el profesor presencial; se integra T08 (PR #8) |
| 5 | Vie 02-10 | Presencial | Nicolás, Lucas, Luis | Registro del Scrum Master | T13 terminada y enviada a revisión |
| 6 | Lun 05-10 | Presencial | Nicolás, Lucas, Luis | Registro del Scrum Master | Cierre del Sprint 1: revisión del PR #10, T14 y T15 integradas, inicio del Sprint 2 |

**Asistencia:** Nicolás y Luis asistieron a las 6 reuniones; Lucas, a 4 de 6.

---

## Daily 1 — Lunes 28-09-2026

**Asistentes:** Nicolás Jiménez y Luis Hernández. Lucas Flores no asistió.

| Integrante | Qué hice | Qué haré | Bloqueos |
|---|---|---|---|
| Nicolás Jiménez | Integré la base técnica (T01, T02, T03; PR #1) y el modelo de datos con el desglose de cierre de caja (T04; PR #3) | Seed de roles y administrador (T05) y autenticación JWT (T06) | Ninguno |
| Luis Hernández | Trabajé en local el modelo de datos según el ERD final y el seed de roles (T04, T05) | Guard de roles y decoradores de autorización (T07) | Ninguno |

**Acuerdos:**
- Informar a Lucas de lo conversado y de su tarea siguiente: pantalla de login en Next.js (T09).
- Una tarea por rama, siguiendo `AGENTS.md`.
- Registrar el ID commit en Notion al terminar cada tarea.

---

## Daily 2 — Martes 29-09-2026

**Asistentes:** Nicolás Jiménez y Luis Hernández. Lucas Flores no asistió.

| Integrante | Qué hice | Qué haré | Bloqueos |
|---|---|---|---|
| Nicolás Jiménez | Avancé el seed (T05) y la autenticación JWT con refresh token (T06) | Integrar T05 y T06, y documentar la API con Swagger (T21) | Ninguno |
| Luis Hernández | Avancé el guard de roles en mi rama | Terminar T07 y abrir su PR | Dudas con la cadena de guards de NestJS; Nicolás apoya en la integración |

**Resultado del día:** se integraron a `main` T05 (PR #4), T21 (PR #5), T06 (PR #6) y T07 (PR #7).

---

## Daily 3 — Miércoles 30-09-2026

| Integrante | Qué hice | Qué haré | Bloqueos |
|---|---|---|---|
| Nicolás Jiménez | Integré seed, autenticación JWT y Swagger | Endpoints de gestión de usuarios: crear, listar y desactivar (T08) | Ninguno |
| Lucas Flores | Avancé la pantalla de login (T09) y la conecté con la API de autenticación | Módulo de gestión de usuarios en el frontend (T10) | Espera los endpoints de usuarios (T08) |
| Luis Hernández | Terminé T07 (guard de roles y política por local), revisado e integrado | Revisar la entidad de auditoría (T12) contra el modelo y el borrador del plan de pruebas | Ninguno |

**Acuerdos:** priorizar T08, porque desbloquea el frontend de usuarios.

---

## Daily 4 — Jueves 01-10-2026

**Modalidad:** Teams, con el tablero de Notion en pantalla. Es la **única sesión grabada** del Sprint 1: el profesor no asistió presencialmente, así que se grabó la reunión y se le envió el enlace.

| Integrante | Qué hice | Qué haré | Bloqueos |
|---|---|---|---|
| Nicolás Jiménez | Terminé el CRUD de usuarios (T08) con validación de RUT y desactivación sin borrar datos | Integrar T08 e iniciar el interceptor de auditoría (T13) | Ninguno |
| Lucas Flores | Avancé login y gestión de usuarios en el frontend | Conectar la gestión de usuarios con T08 y la redirección por rol (T11) | T11 bloqueada: el Portal del Trabajador aún no existe (historia E4-H1 del Sprint 5) |
| Luis Hernández | Confirmé que la tabla de auditoría (T12) quedó cubierta en el modelo de datos de T04; actualicé el tablero | Plan de pruebas de E1-H1 y E1-H2 | Ninguno |

**Resultado del día:** T08 integrada a `main` (PR #8). T11 queda en estado **Bloqueado** en Notion.

---

## Daily 5 — Viernes 02-10-2026

| Integrante | Qué hice | Qué haré | Bloqueos |
|---|---|---|---|
| Nicolás Jiménez | Integré T08; terminé el interceptor de auditoría (T13) para login, creación y desactivación de usuarios | Revisión de T13 y luego consulta de auditoría (T14) e inmutabilidad (T15) | Ninguno |
| Lucas Flores | Conecté el frontend con los endpoints de usuarios | Subir el PR del frontend (T09–T11) durante el fin de semana | Ninguno |
| Luis Hernández | Avancé el plan de pruebas por criterio de aceptación | Revisar el PR de T13 y seguir con la documentación | Ninguno |

**Resultado del día:** T13 pasa a **En revisión** (PR #9, integrado el domingo 04-10).

---

## Reunión de cierre del Sprint 1 — Lunes 05-10-2026

**Temas tratados:**

1. **Estado del Sprint Backlog.** El backend de las dos historias quedó completo: T14 (PR #11) y T15 (PR #12) se integraron ese día. Queda pendiente el frontend (T09–T11 y T16) y la verificación de criterios (T17 y T18).
2. **Revisión del PR #10 ("Frontend", T09–T11).** No se puede integrar por 5 problemas bloqueantes:
   - el build falla, porque un componente `'use client'` importa código de servidor;
   - T10 no redirige a roles distintos de ADMINISTRADOR;
   - el rol se lee de una cookie sin firma, lo que permite falsificarlo;
   - falta `BACKEND_INTERNAL_URL` en docker-compose, por lo que el login da 502 en Docker;
   - Prettier falla en 26 archivos.

   También se revisaron problemas de proceso: tres tareas en una sola rama, rama sin actualizar desde `main` y commits fuera de la convención.
3. **Locales.** No existen locales en la base de datos (ni seed ni endpoint `GET /stores`), por lo que desde la interfaz no se pueden crear usuarios SUPERVISOR ni TRABAJADOR. Esto bloquea el criterio 1 de E1-H1.
4. **Pendiente para cerrar el sprint:** la documentación Scrum (tareas T22 a T31).
5. **Inicio del Sprint 2:** E1-H3, Carga de documentos laborales (13 pts), y E2-H1, Publicación de liquidaciones (8 pts).

**Acuerdos:**

| Acción | Responsable |
|---|---|
| Corregir los bloqueantes del PR #10 y separar T09, T10 y T11 en ramas propias | Lucas Flores |
| Crear tarea para el seed de locales y el endpoint `GET /stores` | Nicolás Jiménez |
| Preparar la documentación Scrum del Sprint 1 (T22–T31) | Luis Hernández |
| Ejecutar las pruebas de aceptación (T17, T18) cuando el frontend esté integrado | Luis Hernández |

---

## Días sin daily

| Fecha | Motivo |
|---|---|
| Sáb 03-10 y dom 04-10 | Fin de semana (Lucas subió el PR #10 el sábado; T13 se integró el domingo) |
| Mar 06-10 | No hubo reunión |
