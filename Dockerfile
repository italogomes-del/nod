# definido em 2026-09-17: a imagem compartilhada inclui a web compilada, sem Electron nem CLI no runtime.
FROM node:24.19.0-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:24.19.0-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
# definido em 2026-10-02: o deploy migra com a própria imagem (docker compose run nod node scripts/migrate.ts).
COPY scripts/migrate.ts scripts/seed.ts ./scripts/
COPY tests/helpers/catcher-roteiro.ts ./tests/helpers/catcher-roteiro.ts
COPY --from=web /app/dist/web ./dist/web
ENV NODE_ENV=production
ENV NOD_MODO=compartilhado
ENV NOD_STATIC_DIR=/app/dist/web
EXPOSE 8888
CMD ["node", "src/adapters/http/server.ts"]
