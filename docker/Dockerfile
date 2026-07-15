# This source code is licensed under the terms of the
# GNU Affero General Public License found in the LICENSE file in
# the root directory of this source tree.
#
# Copyright (c) 2021-present Kaleidos INC

# ---- Build stage: compile the AngularJS app from source ----
FROM node:16.19.1 AS build
LABEL maintainer="support@taiga.io"

WORKDIR /app

# The build base (node:16.19.1) is Debian 10 "buster", which is EOL: its
# deb.debian.org repositories are archived, so a plain `apt-get update` 404s.
# Repoint apt at archive.debian.org (and skip the expired Valid-Until check) so
# the native build deps below can be installed.
#   - python3/make/g++ : node-gyp toolchain for node-sass
#   - autoconf/automake/libtool/pkg-config : autotools needed by gifsicle@5.1.0,
#     whose prebuilt binary is unavailable (404) so its install script compiles
#     the bundled gifsicle-1.92 source via `autoreconf -ivf && ./configure && make`.
# [setup/infrastructure fix — EOL base-image apt mirror + gifsicle source-build
#  toolchain; no application behavior change]
RUN sed -i -e 's|http://deb.debian.org/debian|http://archive.debian.org/debian|g' \
           -e 's|http://deb.debian.org/debian-security|http://archive.debian.org/debian-security|g' \
           -e '/buster-updates/d' /etc/apt/sources.list \
    && apt-get -o Acquire::Check-Valid-Until=false update \
    && apt-get install -y --no-install-recommends \
        python3 make g++ autoconf automake libtool pkg-config \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx gulp deploy

# ---- Runtime stage: serve the compiled dist/ with nginx ----
FROM nginx:1.23-alpine
LABEL maintainer="support@taiga.io"

COPY docker/default.conf /etc/nginx/conf.d/default.conf
COPY docker/config_env_subst.sh /docker-entrypoint.d/30_config_env_subst.sh

RUN set -eux; \
    apk add --no-cache bash; \
    chmod +x /docker-entrypoint.d/30_config_env_subst.sh; \
    mkdir -p /usr/share/nginx/html/plugins; \
    cd /usr/share/nginx/html/plugins; \
    wget https://github.com/taigaio/taiga-contrib-slack/archive/6.10.0.zip -O source.zip; \
    unzip -j source.zip "taiga-contrib-slack-6.10.1/front/dist/*" -d slack; \
    rm source.zip; \
    wget http://github.com/taigaio/taiga-contrib-github-auth/archive/6.10.0.zip -O source.zip; \
    unzip -j source.zip "taiga-contrib-github-auth-6.10.1/front/dist/*" -d github-auth; \
    rm source.zip; \
    wget http://github.com/taigaio/taiga-contrib-gitlab-auth/archive/6.10.0.zip -O source.zip; \
    unzip -j source.zip "taiga-contrib-gitlab-auth-6.10.1/front/dist/*" -d gitlab-auth; \
    rm source.zip

COPY --from=build /app/dist/ /usr/share/nginx/html/
COPY docker/conf.json.template /usr/share/nginx/html/
