# LGU admin portal, built once and served as static files.
#
# The BHW client is not built here: it ships as an APK wrapping `dist/`, and a
# container that served it would be a cloud-only path into the field workflow.
#
# The Supabase values arrive as build arguments rather than runtime environment,
# because Vite substitutes `import.meta.env.VITE_*` at build time — a container
# started with a different VITE_SUPABASE_URL would keep serving the one that was
# baked in, silently. Changing any of them means rebuilding the image.
#
# Nothing secret belongs in these arguments. The publishable key is exposed in
# the bundle by design and is only safe because row level security is enabled on
# every table; the service role key must never be passed here.

FROM node:22-alpine AS build

WORKDIR /app

# Dependencies first, so an edit to src/ does not reinstall node_modules.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_BARANGAY_NAME

# Fail here rather than serving a portal that cannot reach the database, or one
# whose exported reports carry no barangay name.
RUN test -n "$VITE_SUPABASE_URL" \
    && test -n "$VITE_SUPABASE_PUBLISHABLE_KEY" \
    && test -n "$VITE_BARANGAY_NAME" \
    || (echo "VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY and VITE_BARANGAY_NAME are required build arguments" && false)

RUN npm run build:admin

FROM nginx:alpine

COPY --from=build /app/dist-admin /usr/share/nginx/html

# React Router owns the paths under /admin, so every unmatched request has to
# return index.html rather than nginx's 404 — otherwise a reloaded page or a
# pasted link lands on an error instead of the route.
RUN printf 'server {\n\
  listen 80;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
\n\
  location /assets/ {\n\
    expires 1y;\n\
    add_header Cache-Control "public, immutable";\n\
  }\n\
\n\
  location / {\n\
    try_files $uri $uri/ /index.html;\n\
  }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80
