# syntax=docker/dockerfile:1

# ---- Dependencias ----
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# prisma/ y prisma.config.ts antes de npm ci: el postinstall ejecuta
# `prisma generate` y deja el cliente disponible para las etapas siguientes
# (incluida la migración con `npx prisma migrate deploy`).
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci

# ---- Compilación ----
FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- Producción ----
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S nodejs && adduser -S nestjs -G nodejs
COPY --from=build --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nestjs:nodejs /app/dist ./dist
COPY --chown=nestjs:nodejs package.json ./
USER nestjs
EXPOSE 3001
CMD ["node", "dist/main.js"]
