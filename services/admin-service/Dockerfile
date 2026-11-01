FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY tsconfig.base.json ./
COPY services/admin-service/ ./services/admin-service/
RUN npm ci --ignore-scripts --no-audit --fund=false
RUN npm run build --workspace=@urbanfleet/admin-service

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/services/admin-service/dist ./dist
COPY --from=builder /app/services/admin-service/package.json ./package.json
EXPOSE 4006
CMD ["node", "dist/index.js"]
