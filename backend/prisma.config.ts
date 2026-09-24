import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// URL por defecto: PostgreSQL local de desarrollo levantado con docker compose
// (mismas credenciales documentadas en .env.example). En producción y pruebas
// se sobrescribe con la variable de entorno DATABASE_URL.
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://postgres:cambiar-en-produccion@localhost:5433/subway_gestion';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: databaseUrl,
  },
});
