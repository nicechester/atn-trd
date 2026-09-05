FROM node:24-alpine AS builder
WORKDIR /app

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

RUN apk add --no-cache sqlite

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server ./server

# Replace workspace symlink with real built shared package
RUN rm -rf /app/node_modules/@atn-trd/shared && mkdir -p /app/node_modules/@atn-trd/shared
COPY --from=builder /app/shared/dist /app/node_modules/@atn-trd/shared/dist
COPY --from=builder /app/shared/package.json /app/node_modules/@atn-trd/shared/package.json

ENV NODE_ENV=production
ENV ATN_DATA_DIR=/data

EXPOSE 8080
VOLUME ["/data"]

CMD ["node_modules/.bin/tsx", "server/src/main.ts"]
