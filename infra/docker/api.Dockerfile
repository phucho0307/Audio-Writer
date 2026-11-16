# syntax=docker/dockerfile:1.7
# API image. Also runs the narration worker (RUN_WORKER, default on), so it
# carries Python + edge-tts and ffmpeg. Build from the repo root:
#   docker build -f infra/docker/api.Dockerfile -t nhipbut-api .
# Targets: `runtime` (default, the server) and `migrate` (one-shot
# `prisma migrate deploy`, run before the API on every deploy).

FROM node:22-bookworm-slim AS build
WORKDIR /app
# Prisma's engines need OpenSSL present when the client is generated.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
# Manifests first, so dependency install is cached until they change.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
# Every workspace manifest, even unused ones: the lockfile lists them all.
COPY apps/web/package.json apps/web/
# `extra_ca` is an optional build secret for machines whose antivirus or
# corporate proxy re-signs HTTPS (npm then dies with "Exit handler never
# called" after a certificate error). Pass that root certificate with
#   --secret id=extra_ca,src=path/to/root.pem
# It is read only while downloading and never lands in the image. Servers
# and CI do not need it.
RUN --mount=type=secret,id=extra_ca,required=false \
    NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca \
    npm ci --workspace=@aw/api --workspace=@aw/shared --include-workspace-root \
  && mkdir -p apps/api/node_modules
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN --mount=type=secret,id=extra_ca,required=false \
    NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca \
    npm run build -w @aw/shared \
  && npx -w @aw/api prisma generate \
  && npm run build -w @aw/api

# Applies pending migrations and exits. Keeps the Prisma CLI (a dev
# dependency) out of the runtime image.
FROM build AS migrate
WORKDIR /app/apps/api
CMD ["npx", "prisma", "migrate", "deploy"]

FROM build AS prune
RUN npm prune --omit=dev --workspace=@aw/api --workspace=@aw/shared --include-workspace-root

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    EDGE_TTS_PYTHON=python3 \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    PYTHONIOENCODING=utf-8
# ffmpeg encodes narration; python3 + edge-tts synthesise it; tini reaps
# the python children the worker spawns and forwards SIGTERM for a clean
# shutdown.
RUN --mount=type=secret,id=extra_ca,required=false \
    apt-get update && apt-get install -y --no-install-recommends \
      openssl ca-certificates ffmpeg python3 python3-pip tini \
  && if [ -s /run/secrets/extra_ca ]; then \
       cat /etc/ssl/certs/ca-certificates.crt /run/secrets/extra_ca > /tmp/ca.pem; \
       export PIP_CERT=/tmp/ca.pem; \
     fi \
  && pip3 install --no-cache-dir --break-system-packages edge-tts==7.3.1 \
  && rm -rf /var/lib/apt/lists/* /root/.cache /tmp/ca.pem \
  && ln -s /usr/bin/python3 /usr/local/bin/python
# `python` as well as `python3`: a .env carried over from development often
# says EDGE_TTS_PYTHON=python, and an env file overrides the image default.
WORKDIR /app
COPY --from=prune /app/node_modules node_modules
COPY --from=prune /app/packages/shared/package.json packages/shared/
COPY --from=prune /app/packages/shared/dist packages/shared/dist
COPY --from=prune /app/apps/api/package.json apps/api/
COPY --from=prune /app/apps/api/node_modules apps/api/node_modules
COPY --from=prune /app/apps/api/dist apps/api/dist
COPY --from=prune /app/apps/api/scripts/edge_speak.py apps/api/scripts/edge_speak.py
WORKDIR /app/apps/api
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/main.js"]
