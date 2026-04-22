FROM node:24-bookworm-slim AS base

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS deps

COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS dev

ENV NODE_ENV=development
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0"]

FROM deps AS builder

ENV NODE_ENV=production
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3002
ENV HOSTNAME=0.0.0.0

WORKDIR /app

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

RUN mkdir -p data public/uploads

EXPOSE 3002
EXPOSE 1455

CMD ["node", "server.js"]
