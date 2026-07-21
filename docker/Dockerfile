# This source code is licensed under the terms of the
# GNU Affero General Public License found in the LICENSE file in
# the root directory of this source tree.
#
# Copyright (c) 2021-present Kaleidos INC

# ---- Build stage: compile the AngularJS app from source ----
# Node is HARD-PINNED to 16.19.1 (see .nvmrc). The image is referenced by TAG rather
# than by digest on purpose: this lets an operator-provided, locally-patched
# `node:16.19.1` image be honored by `docker build`. A digest pin would force a
# registry pull and bypass that local image.
FROM node:16.19.1 AS build
LABEL maintainer="support@taiga.io"

WORKDIR /app

# node:16.19.1 is built on Debian "buster", which is End-Of-Life: the regular
# deb.debian.org / security.debian.org mirrors no longer serve buster, so a plain
# `apt-get update` fails with 404s and the build is not reproducible. Redirect the
# APT sources to the archive mirror and disable the Valid-Until check (archived
# Release files are intentionally stale). This is idempotent: if the base image was
# already patched to point at archive.debian.org, the sed substitutions are no-ops.
RUN set -eux; \
    sed -i 's|deb.debian.org|archive.debian.org|g; s|security.debian.org|archive.debian.org|g' /etc/apt/sources.list; \
    echo 'Acquire::Check-Valid-Until "false";' > /etc/apt/apt.conf.d/10-archived-buster; \
    apt-get -o Acquire::Check-Valid-Until=false update; \
    apt-get install -y --no-install-recommends python3 make g++; \
    rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx gulp deploy

# ---- Runtime stage: serve the compiled dist/ with nginx ----
FROM nginx:1.23-alpine
LABEL maintainer="support@taiga.io"

# Contrib front-end plugins are pinned to a SINGLE version used as the source of truth
# for BOTH the download tag AND the archive's top-level directory, so the two can never
# drift apart again. GitHub's /archive/<TAG>.zip always extracts to "<repo>-<TAG>/",
# therefore the unzip glob MUST reference the same <TAG>. 6.10.0 is the maintainer-pinned
# "correct contrib version" (taiga-front commit 5250a1049 "fix(docker): Pin correct
# contrib versions"); the previously hard-coded unzip root "6.10.1" no longer matched the
# 6.10.0 download and silently produced empty plugin directories.
ARG TAIGA_CONTRIB_VERSION=6.10.0

COPY docker/default.conf /etc/nginx/conf.d/default.conf
COPY docker/config_env_subst.sh /docker-entrypoint.d/30_config_env_subst.sh

# Download and unpack the three official contrib plugins. Hardening applied:
#  * HTTPS is enforced on every URL via the https:// scheme (the github-auth and
#    gitlab-auth downloads previously used insecure http://).
#  * Extraction is verified: each plugin directory must be non-empty afterwards, so any
#    future tag/root mismatch fails the build LOUDLY instead of silently shipping empty
#    dirs. (GitHub auto-generated source archives are not byte-stable, so a pinned content
#    checksum is unreliable; enforced-HTTPS transport plus this extraction verification is
#    the robust integrity gate here.)
RUN set -eux; \
    apk add --no-cache bash; \
    chmod +x /docker-entrypoint.d/30_config_env_subst.sh; \
    mkdir -p /usr/share/nginx/html/plugins; \
    cd /usr/share/nginx/html/plugins; \
    for plugin in slack:taiga-contrib-slack github-auth:taiga-contrib-github-auth gitlab-auth:taiga-contrib-gitlab-auth; do \
        dir="${plugin%%:*}"; \
        repo="${plugin#*:}"; \
        wget -O source.zip "https://github.com/taigaio/${repo}/archive/${TAIGA_CONTRIB_VERSION}.zip"; \
        unzip -j source.zip "${repo}-${TAIGA_CONTRIB_VERSION}/front/dist/*" -d "${dir}"; \
        rm source.zip; \
        [ -n "$(ls -A "${dir}" 2>/dev/null)" ] || { echo "ERROR: contrib plugin '${dir}' is empty after extraction (tag/root mismatch for ${repo}@${TAIGA_CONTRIB_VERSION})" >&2; exit 1; }; \
    done

COPY --from=build /app/dist/ /usr/share/nginx/html/
COPY docker/conf.json.template /usr/share/nginx/html/
