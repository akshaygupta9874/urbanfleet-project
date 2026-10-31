# Stage 1: Build React Frontend
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . ./

# Build arguments for Vite environment variables
ARG VITE_API_URL=http://localhost:3001
ARG VITE_WS_URL=ws://localhost:3001
ARG VITE_GEOAPIFY_API_KEY=""
ARG VITE_GOOGLE_CLIENT_ID=""

ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL
ENV VITE_GEOAPIFY_API_KEY=$VITE_GEOAPIFY_API_KEY
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID

RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 5173
CMD ["nginx", "-g", "daemon off;"]
