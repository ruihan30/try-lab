# ── Stage 1: Build the React app ──────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Copy package files and install dependencies first (layer caching)
COPY package.json .
RUN npm install

# Accept build arg and expose to Vite at build time
ARG VITE_BACKEND_URL=http://localhost:8000
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL

# Copy source and build
COPY . .
RUN npm run build
# Output goes to /app/dist

# ── Stage 2: Serve with Nginx ──────────────────────────────────────────────
FROM nginx:1.25-alpine
# Copy built assets from stage 1
COPY --from=builder /app/dist /usr/share/nginx/html
# Copy our custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
