FROM node:20-alpine AS build
WORKDIR /app
ENV NODE_ENV=development

COPY package.json package-lock.json* ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm install

COPY backend backend
COPY frontend frontend
RUN npm run build --workspaces \
  && npm prune --omit=dev --workspaces

FROM node:20-alpine

ENV NODE_ENV=production \
    PORT=42069 \
    FRONTEND_DIST=/app/frontend/dist

WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/package-lock.json ./package-lock.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/frontend/dist ./frontend/dist
COPY config.yaml ./config.yaml

EXPOSE 42069/tcp

CMD [ "node", "backend/dist/index.js" ]
