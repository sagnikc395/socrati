# BullMQ worker image. The Next.js app deploys to Vercel; the worker needs an
# always-on process, so it runs from this image on any container host.
FROM node:20-slim

WORKDIR /app

# Install dependencies against the workspace manifests only, so source edits
# don't invalidate the install layer.
COPY package.json package-lock.json .npmrc ./
COPY apps/web/package.json ./apps/web/
COPY packages/ui/package.json ./packages/ui/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/typescript-config/package.json ./packages/typescript-config/
# The worker runs TypeScript directly through tsx, which is a devDependency —
# install dev packages too, then switch to production mode.
RUN npm ci --include=dev

ENV NODE_ENV=production

COPY apps/web ./apps/web
COPY packages ./packages

# Worker reads env from the process environment; pass it with --env-file,
# -e, or your host's secret store. Never bake a .env into the image.
CMD ["npm", "run", "worker", "--workspace=web"]
