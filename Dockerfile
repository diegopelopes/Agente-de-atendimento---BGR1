# =============================================================================
# BGR Benefícios — Dockerfile Oficial de Produção (Prioridade 5)
# Node.js 22+ com suporte nativo a TypeScript e Healthcheck integrado
# =============================================================================
FROM node:22-alpine

WORKDIR /app

# Copia manifesto e código-fonte tipado
COPY package.json ./
COPY config ./config
COPY docs ./docs
COPY prompts ./prompts
COPY schemas ./schemas
COPY src ./src
COPY workflows ./workflows
COPY tests ./tests

# Cria diretório de persistência local (Snapshot JSON)
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3090

EXPOSE 3090

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3090/health || exit 1

CMD ["node", "src/api/visual-server.ts"]
