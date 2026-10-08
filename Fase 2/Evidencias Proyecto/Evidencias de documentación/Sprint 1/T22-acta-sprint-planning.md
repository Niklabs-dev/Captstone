# Acta de Sprint Planning — Sprint 1

**SPRINT-1-T22 · Acta de Sprint Planning del Sprint 1**
**Responsable:** Luis Hernández (Scrum Master)

## 1. Datos de la reunión

| Campo | Valor |
|---|---|
| Fecha | Jueves 24 de septiembre de 2026 |
| Modalidad | Presencial, Duoc UC Sede Melipilla |
| Facilitador | Luis Hernández (Scrum Master) |
| Product Owner | Nicolás Jiménez |
| Equipo de desarrollo | Nicolás Jiménez (Backend), Lucas Flores (Frontend), Luis Hernández (Base de datos, Documentación y Pruebas) |
| Líder técnico | Carlos Quintanilla |

## 2. Duración del sprint

| Campo | Valor |
|---|---|
| Sprint | 1 de 5 |
| Período | 24-09-2026 al 05-10-2026 |
| Duración | 2 semanas (8 días hábiles, descontando el feriado de Fiestas Patrias en la semana previa) |

> La base técnica (T01, T02 y T03) se adelantó el 22-09 para que el equipo pudiera comenzar a desarrollar desde el primer día del sprint. En la reunión se incorporó al Sprint Backlog y se integró a `main` ese mismo día (PR #1).

## 3. Sprint Goal

> Al final de este sprint, el sistema permite crear usuarios con rol y local, controlar el acceso según ese rol, y consultar auditoría inmutable de operaciones críticas.

El objetivo se propuso a partir de las historias priorizadas en el Product Backlog de Fase 1 y fue confirmado por todo el equipo.

## 4. Historias comprometidas

| Historia | Descripción | Puntos |
|---|---|---|
| E1-H1 | Gestión de usuarios y asignación de roles | 8 |
| E1-H2 | Registro de auditoría de operaciones críticas | 5 |
| **Total** | | **13** |

Se eligieron por ser la base de todos los módulos posteriores (sin usuarios, roles y auditoría no se pueden construir los módulos documental, de propinas, de caja ni de inventario) y por su peso legal: la Ley N°21.719 exige trazabilidad del acceso a datos personales.

### Criterios de aceptación

**E1-H1 — Gestión de usuarios y asignación de roles**
1. El administrador puede crear un usuario asignándole rol y local.
2. Cada usuario accede solo a lo que su rol permite y es redirigido a su vista correspondiente.
3. Un usuario desactivado no puede ingresar, pero sus datos y documentos se conservan.

**E1-H2 — Registro de auditoría de operaciones críticas**
1. Se pueden consultar las operaciones críticas filtrando por local y fecha.
2. El registro de auditoría no puede modificarse ni eliminarse.

## 5. Desglose en tareas y reparto

| ID | Tarea | Historia | Tipo | Responsable | Est. (h) |
|---|---|---|---|---|---|
| T01 | Inicializar monorepo: backend NestJS + frontend Next.js | Base técnica | Backend | Nicolás Jiménez | 3 |
| T02 | Configurar calidad de código y variables de entorno | Base técnica | Backend | Nicolás Jiménez | 2 |
| T03 | Dockerizar la aplicación (Dockerfiles + docker-compose con PostgreSQL) | Base técnica | DevOps | Nicolás Jiménez | 5 |
| T04 | Diseñar modelo de datos: usuarios, roles y locales | E1-H1 | Base de datos | Luis Hernández | 4 |
| T05 | Crear seed: roles base, administrador inicial y tipos de documento | E1-H1 | Base de datos | Luis Hernández | 2 |
| T06 | Implementar autenticación JWT (login + bcrypt + refresh token) | E1-H1 | Backend | Nicolás Jiménez | 6 |
| T07 | Guard de roles y decoradores de autorización por rol y local | E1-H1 | Backend | Luis Hernández | 4 |
| T08 | Endpoints CRUD de usuarios: crear, listar y desactivar | E1-H1 | Backend | Nicolás Jiménez | 5 |
| T09 | Pantalla de login en Next.js con tokens y rutas protegidas | E1-H1 | Frontend | Lucas Flores | 5 |
| T10 | Módulo de gestión de usuarios en frontend (solo administrador) | E1-H1 | Frontend | Lucas Flores | 6 |
| T11 | Redirección por rol hacia el Portal del Trabajador | E1-H1 | Frontend | Lucas Flores | 2 |
| T12 | Diseñar entidad de auditoría | E1-H2 | Base de datos | Luis Hernández | 3 |
| T13 | Interceptor de auditoría para operaciones críticas | E1-H2 | Backend | Nicolás Jiménez | 4 |
| T14 | Endpoint de consulta de auditoría con filtros por local y fecha | E1-H2 | Backend | Nicolás Jiménez | 3 |
| T15 | Garantizar inmutabilidad del registro de auditoría | E1-H2 | Backend | Nicolás Jiménez | 2 |
| T16 | Vista de auditoría en frontend con filtros | E1-H2 | Frontend | Lucas Flores | 4 |
| T17 | Verificar criterios de aceptación de E1-H1 | Cierre | QA | Luis Hernández | 3 |
| T18 | Verificar criterios de aceptación de E1-H2 | Cierre | QA | Luis Hernández | 2 |
| T19 | Documentar levantamiento del entorno en README | Cierre | Documentación | Nicolás Jiménez | 2 |
| T20 | Preparar demo del Sprint Review | Cierre | Documentación | Luis Hernández | 2 |
| T21 | Documentar API con Swagger (OpenAPI) | Base técnica | Documentación | Nicolás Jiménez | 2 |
| | **Total** | | | | **71** |

**Criterio de reparto:** cada integrante tomó las tareas de su área (Luis: base de datos y pruebas; Nicolás: backend e infraestructura; Lucas: frontend). Las tareas de cierre de sprint (QA y documentación) quedaron en el rol de Documentación y Pruebas.

**Carga estimada por integrante:**

| Integrante | Tareas | Horas |
|---|---|---|
| Nicolás Jiménez | T01, T02, T03, T06, T08, T13, T14, T15, T19, T21 | 34 |
| Lucas Flores | T09, T10, T11, T16 | 17 |
| Luis Hernández | T04, T05, T07, T12, T17, T18, T20 | 20 |

> Las tareas de documentación Scrum T22 a T31 (17 h, Luis Hernández) se agregaron al tablero durante el sprint, al acordarse en la reunión del 05-10 que la documentación era lo pendiente para cerrar el Sprint 1.

## 6. Definition of Done

Se adopta la Definition of Done descrita en [T23-definition-of-done.md](T23-definition-of-done.md), basada en las reglas de calidad de `AGENTS.md`.

## 7. Acuerdos

1. **Tablero oficial:** Notion, "Tablero de trabajo - Captstone SubWay". Estados: Por hacer → En curso → En revisión → Hecho (o Bloqueado).
2. **Trazabilidad:** al terminar una tarea se registra en Notion su **ID commit** y un comentario breve de lo realizado.
3. **Repositorio único:** `github.com/Niklabs-dev/Captstone`. Una tarea = una rama = un Pull Request; integración a `main` solo con revisión.
4. **Daily Standup:** de lunes a viernes, máximo 15 minutos, facilitado por el Scrum Master. Si un integrante no puede asistir, informa su avance por el grupo del equipo.
5. **Convenciones:** commits en español con formato Conventional Commits y el ID de la tarea (ej.: `feat: agrega login con JWT (SPRINT-1-T06)`); identificadores de código en inglés.

## 8. Riesgos identificados

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Integrantes sin experiencia previa en NestJS, Next.js y Git | Alta | Medio | Guía de contribución (T27), `AGENTS.md` y apoyo entre pares en las revisiones de PR |
| Arquitectura concentrada en un integrante; el resto debe poder defenderla ante la comisión | Media | Alto | Revisión cruzada de PR y documentación técnica compartida |
| Dependencia del frontend respecto de los endpoints del backend | Media | Medio | Priorizar autenticación y CRUD de usuarios al inicio del sprint |
| Sprint corto por el feriado de Fiestas Patrias | Alta | Medio | Base técnica adelantada antes del planning |
