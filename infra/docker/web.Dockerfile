# syntax=docker/dockerfile:1.7
# Web image: Next.js standalone output, so the runtime carries only the
# files the server actually imports. Build from the repo root:
#   docker build -f infra/docker/web.Dockerfile \
#     --build-arg NEXT_PUBLIC_MEDIA_BASE=https://media.example.com -t nhipbut-web .
#
# NEXT_PUBLIC_* values are compiled into the browser bundle, so they are
# build arguments, not run-time environment.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
# Every workspace manifest, even unused ones: the lockfile lists them all.
COPY apps/api/package.json apps/api/
# Optional `extra_ca` build secret for machines whose antivirus or proxy
# re-signs HTTPS; see api.Dockerfile. Never lands in the image.
RUN --mount=type=secret,id=extra_ca,required=false \
    NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca \
    npm ci --workspace=@aw/web --workspace=@aw/shared --include-workspace-root
COPY packages/shared packages/shared
COPY apps/web apps/web
# Same origin as the site: the reverse proxy sends /api and /collab to the API.
ARG NEXT_PUBLIC_API_URL=/api
# Where cover art is served from (the R2 public URL). Empty serves public/.
ARG NEXT_PUBLIC_MEDIA_BASE=
ARG API_URL=http://api:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_MEDIA_BASE=$NEXT_PUBLIC_MEDIA_BASE \
    API_URL=$API_URL \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @aw/shared && npm run build -w @aw/web

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static apps/web/.next/static
COPY --from=build /app/apps/web/public apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
