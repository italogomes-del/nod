# Servidor do nod. SEM CLI do fornecedor: o executor roda na máquina da pessoa (ADR-014 invertido, ADR-021).
# O Node 24 executa .ts direto (type stripping); por isso `erasableSyntaxOnly` no tsconfig.base.json e
# nenhum runner (tsx é devDependency e a imagem é --omit=dev). `--ignore-scripts` porque o `prepare`
# (simple-git-hooks, devDependency) roda no `npm ci` e não existe na imagem (medido em 2026-09-16:
# sem a flag o build cai com "simple-git-hooks: not found", exit 127). `.dockerignore` mantém
# node_modules e .env fora do COPY. Verificado em 2026-09-16: `docker build` + `docker run` respondem /api/saude.
FROM node:24.19.0-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY . .
ENV NODE_ENV=production
EXPOSE 8888
CMD ["node", "src/adapters/http/server.ts"]
