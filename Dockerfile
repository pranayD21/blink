# The production image (Task 42): the web server and the worker in one container, started by
# scripts/start-prod.sh. The database lives on a volume at BLINK_DB_PATH (default /data/blink.db,
# where Railway mounts the volume; a Railway variable overrides it), never in the image.
FROM node:26-bookworm-slim

# A fallback only: better-sqlite3 13 ships N-API prebuilds for linux-x64 and linux-arm64 inside its
# package, so nothing compiles. The tools are here in case a future version or platform has none.
# procps is not a fallback: it provides `ps`, which concurrently (through tree-kill) runs to stop
# the web server and the worker. Without it, every stop or redeploy ended in "spawn ps ENOENT" and a
# crash report.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ procps \
  && rm -rf /var/lib/apt/lists/*

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1

# Node 25 and later no longer bundle corepack, so it is installed first. It then runs the pnpm
# named in package.json's packageManager and no other.
RUN npm install -g corepack@0.36.0 && corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack install
# Development dependencies too: the start script runs tsx and drizzle-kit. `blink...` is the web
# app and its dependencies only; the desktop package (Electron) is neither copied nor installed.
RUN pnpm install --frozen-lockfile --filter blink...

COPY . .

# Only after the install, which would otherwise skip the development dependencies.
ENV NODE_ENV=production
RUN pnpm build

# Set after the build, so nothing at build time can open a database under /data.
ENV BLINK_DB_PATH=/data/blink.db

EXPOSE 3000
CMD ["sh", "scripts/start-prod.sh"]
