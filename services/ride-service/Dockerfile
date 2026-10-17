FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY tsconfig.base.json ./
COPY packages/ ./packages/
COPY services/ride-service/ ./services/ride-service/

RUN npm install
RUN npm run build --workspace=@urbanfleet/common
RUN npm run build --workspace=@urbanfleet/contracts
RUN npm run build --workspace=@urbanfleet/ride-service

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/services/ride-service/dist ./dist
COPY --from=builder /app/services/ride-service/src/generated ./src/generated
COPY --from=builder /app/services/ride-service/package.json ./package.json
COPY --from=builder /app/services/ride-service/prisma ./prisma

EXPOSE 4004
CMD ["node", "dist/index.js"]
