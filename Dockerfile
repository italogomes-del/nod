# Servidor do nod. SEM CLI do fornecedor: o executor roda na máquina da pessoa (ADR-014 invertido, ADR-021).
FROM node:24.19.0-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 8888
CMD ["npx", "tsx", "src/adapters/http/server.ts"]
