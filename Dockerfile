FROM node:24-alpine

WORKDIR /app

# Dev dependencies stay installed: drizzle-kit applies migrations on start, and tsx runs
# the one-time scripts (migrate:legacy, user:create) inside the container.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

EXPOSE 3000

# Migrations are idempotent, so every start (and every Dockhand sync) brings the schema up to date.
CMD ["sh", "-c", "npx drizzle-kit migrate && node .output/server/index.mjs"]
