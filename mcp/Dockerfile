FROM node:22-alpine AS deps
WORKDIR /app

COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    HTTP_HOST=0.0.0.0 \
    HTTP_PORT=8788

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY PROMPT.md ./PROMPT.md

EXPOSE 8788/tcp

CMD ["node", "dist/src/index.js"]
