FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-alpine AS run
RUN apk add --no-cache python3
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY config/ ./config/
COPY data/ ./data/
ENV DATA_DIR=/app/data
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]
