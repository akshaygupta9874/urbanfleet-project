FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY tsconfig.base.json ./
COPY packages/ ./packages/
COPY services/payment-service/ ./services/payment-service/

RUN npm config set fetch-retries 5 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retry-maxtimeout 120000 \
    && npm install
RUN npm run build:packages
RUN npm run build --workspace=@urbanfleet/payment-service

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/services/payment-service/dist ./dist
COPY --from=builder /app/services/payment-service/src/generated ./src/generated
COPY --from=builder /app/services/payment-service/package.json ./package.json
COPY --from=builder /app/services/payment-service/prisma ./prisma
COPY --from=builder /app/services/payment-service/prisma.config.ts ./prisma.config.ts

EXPOSE 4005
CMD ["node", "dist/index.js"]
