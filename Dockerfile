FROM node:24-alpine AS builder
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json tsconfig.base.json ./
COPY shared/package*.json ./shared/
COPY server/package*.json ./server/
COPY web/package*.json ./web/
RUN npm install

COPY shared ./shared
COPY server ./server
COPY web ./web

RUN npm run build --workspace=shared
RUN npm run build --workspace=web
RUN cp -r web/dist server/public

FROM node:24-alpine
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/server ./server

ENV NODE_ENV=production
ENV ATN_DATA_DIR=/data

EXPOSE 8080
VOLUME ["/data"]

CMD ["node_modules/.bin/tsx", "server/src/main.ts"]
