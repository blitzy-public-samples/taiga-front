# This source code is licensed under the terms of the
# GNU Affero General Public License found in the LICENSE file in
# the root directory of this source tree.
#
# Copyright (c) 2021-present Kaleidos INC

# ---- Build stage: compile the client from source ----
FROM node:16.19.1 AS build
WORKDIR /app

# native build deps for node-gyp (node:16.19.1 is Debian "buster"-based → use apt-get).
# python3/make/g++ are needed to (re)build native addons in the tree (e.g. the
# gifsicle/mozjpeg/optipng image optimizers) when a prebuilt binary is unavailable.
# NOTE: Debian buster is EOL, so its apt repositories have moved to archive.debian.org;
# repoint sources there (and skip the Valid-Until check) so `apt-get update` resolves.
RUN sed -i -e 's|http://deb.debian.org/debian|http://archive.debian.org/debian|g' \
           -e 's|http://security.debian.org/debian-security|http://archive.debian.org/debian-security|g' \
           -e 's|http://deb.debian.org/debian-security|http://archive.debian.org/debian-security|g' \
           -e '/buster-updates/d' /etc/apt/sources.list \
    && apt-get -o Acquire::Check-Valid-Until=false update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# A few dependencies pinned in package-lock.json use git+ssh:// GitHub URLs; rewrite
# them to anonymous HTTPS so `npm ci` can fetch them inside this hermetic build
# without an SSH key (mirrors the git config used by CI).
RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" \
    && git config --global url."https://github.com/".insteadOf "git@github.com:"

# install from the committed lockfile first (fails fast on a stale lock —
# this is WHY package-lock.json is regenerated in the root)
COPY package.json package-lock.json ./
RUN npm ci

# copy the rest of the source and build:
# coffee + jade + elements + NEW esbuild react-app.js + themes
COPY . .
RUN npx gulp deploy

# ---- Runtime stage: serve the compiled dist via nginx ----
FROM nginx:1.23-alpine
LABEL maintainer="support@taiga.io"

# bash is required at container start by /docker-entrypoint.d/30_config_env_subst.sh,
# a #!/bin/bash script that uses arrays; the nginx:alpine base ships only BusyBox sh.
RUN apk add --no-cache bash

COPY docker/default.conf /etc/nginx/conf.d/default.conf
COPY docker/conf.json.template /usr/share/nginx/html/conf.json.template
COPY docker/config_env_subst.sh /docker-entrypoint.d/30_config_env_subst.sh
RUN chmod +x /docker-entrypoint.d/30_config_env_subst.sh

COPY --from=build /app/dist/ /usr/share/nginx/html/
