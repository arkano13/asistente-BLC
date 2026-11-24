FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json prisma.config.ts tsconfig.json ./
COPY prisma ./prisma
RUN npm ci
COPY src ./src
COPY scripts ./scripts
COPY empresas ./empresas
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json /app/prisma.config.ts ./
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/empresas ./empresas
# El comando lo define cada servicio: core o gateway (ver README).
CMD ["npm", "run", "start:core"]
