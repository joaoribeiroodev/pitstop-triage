# Backend PitStop (NestJS). Contexto de build: raiz do monorepo.
#   docker build -f apps/api/Dockerfile -t pitstop-api .
# A mesma imagem roda no Railway e, depois, em uma VPS com Coolify — sem mudança de código.

FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY apps/api/package.json apps/api/
# Só os workspaces do backend: as dependências dos frontends Angular ficam fora da imagem.
RUN npm ci --workspace @pitstop/shared-types --workspace @pitstop/api --include-workspace-root=false
COPY packages/shared-types packages/shared-types
COPY apps/api apps/api
RUN npm run build -w @pitstop/shared-types && npm run build -w @pitstop/api \
 && npm prune --omit=dev --workspace @pitstop/shared-types --workspace @pitstop/api --include-workspace-root=false

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /repo
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/packages/shared-types/package.json packages/shared-types/package.json
COPY --from=build /repo/packages/shared-types/dist packages/shared-types/dist
COPY --from=build /repo/apps/api/package.json apps/api/package.json
COPY --from=build /repo/apps/api/dist apps/api/dist
USER node
WORKDIR /repo/apps/api
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/v1/health" || exit 1
CMD ["node", "dist/main.js"]
