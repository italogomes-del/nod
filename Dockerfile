# CLI pinado por versão EXATA. SEM as libs do Chrome. (ADR-014 / ADR-018)
FROM node:22.14.0-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 8787
CMD ["npx", "tsx", "http/server.ts"]
