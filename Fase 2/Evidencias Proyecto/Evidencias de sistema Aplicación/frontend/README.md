This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## SPRINT-1-T10: administración de usuarios

Vista: `/admin/usuarios`. Crear, listar, buscar, filtrar por rol, local y estado,
y desactivar cuentas con confirmación. Solo el administrador puede acceder.
La sesión `mf_access` se verifica mediante NestJS; ni el JWT ni las contraseñas
guardadas se exponen en las respuestas al navegador. Las mutaciones requieren
el origen del frontend y el backend conserva la auditoría de las operaciones.

Esta rama parte de `main` y depende del login de SPRINT-1-T09 (PR #16) para
la navegación completa. No incluye el login ni la redirección por rol de T11.

Configuración del servidor: `BACKEND_INTERNAL_URL` y, opcionalmente,
`USER_MANAGEMENT_STORES` (ver `.env.example`). Como el backend todavía no expone
un catálogo de locales, se combinan los locales de usuarios existentes con los
locales configurados. Los IDs deben corresponder a locales activos en PostgreSQL;
el backend verifica su existencia. Sin locales disponibles solo se pueden crear
administradores y contadores. No se inventan IDs ni se muestran campos técnicos
para asignar un local.

```powershell
npm ci
npm run lint
npm run format:check
npm run test:users
npm run build
npm run test:users:integration
npx playwright install chromium
```

Las pruebas de navegador usan un proyecto Docker exclusivo y datos ficticios.
Configura `TEST_USERS_ADMIN_EMAIL` y `TEST_USERS_ADMIN_PASSWORD` con las credenciales
del seed de desarrollo y ejecuta desde `frontend/`:

```powershell
./scripts/test-users.ps1
```

El script usa puertos 3102 (frontend), 3103 (backend) y 5434 (PostgreSQL), crea
un local ficticio y ejecuta Playwright en escritorio y móvil. Las cuentas de
prueba quedan desactivadas; el volumen y la auditoría se conservan exclusivamente
en `capstone-sprint1-t10` para inspección. No ejecutar contra datos de producción.
Las capturas y trazas se guardan en `test-results/`, fuera de Git.
