# This source code is licensed under the terms of the
# GNU Affero General Public License found in the LICENSE file in
# the root directory of this source tree.
#
# Copyright (c) 2021-present Kaleidos INC

# =====================================================================================
# [C-10] Step-0 provenance reconciliation.
#
# AAP §0.7.2 mandates a "Step 0" that advances the parent repo's taiga-front submodule
# pointer from a17d8c9 to 8a73e14 — the commit that switches this Dockerfile from
# downloading a prebuilt taiga-front-dist tarball to BUILDING THE CLIENT FROM SOURCE,
# the only flow that lets the new React bundle (react-app.js) reach the served image.
# In this working tree the taiga-front submodule sits on a migration lineage whose
# merge-base with 8a73e14 is the pre-migration baseline a17d8c9 — i.e. 8a73e14 is NOT
# an ancestor of the current HEAD, so the Step-0 change could not be fast-forwarded and
# was instead reconstructed here on the current lineage. This Dockerfile therefore
# re-establishes — and hardens — the 8a73e14 build-from-source contract: identical base
# images (node:16.19.1 build stage, nginx:1.23-alpine runtime), the identical
# `npm ci` + `npx gulp deploy` compile, and the same Slack/GitHub/GitLab contrib-plugin
# delivery (restored below, M-19). Reconciliation for the parent gitlink: point the
# submodule at a coherent descendant of THIS lineage (which contains this Dockerfile),
# not at the orphaned 8a73e14 commit.
# =====================================================================================

# ---- Build stage: compile the client from source ----
# [M-18] Base image digest-pinned for a reproducible, tamper-evident build. The
# node:16.19.1 tag floats; the @sha256 pin freezes the exact multi-arch index so the
# build cannot silently drift to a re-pushed tag. Node 16.19.1 is AAP-frozen
# (AAP §0.5.1/§0.7.2: every migrated dependency is pinned to a Node-16-compatible
# release and the deliverable toolchain IS Node 16.19.1) — it is intentionally NOT
# bumped even though Node 16 is EOL, because that is the contract the whole dependency
# tree (node-sass@8, jest@29, @playwright/test@1.44.1, …) was resolved against. Digest
# resolved from Docker Hub (docker manifest inspect / RepoDigests) for node:16.19.1.
FROM node:16.19.1@sha256:e97b6d302062583e09be70f430b703637f6ef26c2cbb0d7bfed61e0be9d7a974 AS build
WORKDIR /app

# native build deps for node-gyp (node:16.19.1 is Debian "buster"-based → use apt-get).
# python3/make/g++ are needed to (re)build native addons in the tree (e.g. node-sass and
# the gifsicle/mozjpeg/optipng image optimizers) when a prebuilt binary is unavailable.
#
# [M-18] Debian buster is EOL, so its apt repositories have moved to archive.debian.org;
# repoint sources there so `apt-get update` resolves. `Acquire::Check-Valid-Until=false`
# ONLY relaxes the metadata-expiry (Valid-Until) check — which necessarily fails for a
# frozen EOL suite whose Release date is long past — it does NOT disable apt's GPG
# verification: the archive Release file is still signature-verified and every .deb is
# checksum-verified against that signed manifest, so package integrity/authenticity is
# preserved. Sources are fetched over HTTPS (transport encryption in addition to GPG,
# using the base image's ca-certificates). This EOL-suite handling is an inherent
# consequence of the AAP-frozen Node-16/buster toolchain above, not a security opt-out;
# a fully maintained, SBOM-attested internal build image is the longer-term path once
# the toolchain freeze is lifted.
RUN sed -i -e 's|http://deb.debian.org/debian|https://archive.debian.org/debian|g' \
           -e 's|http://security.debian.org/debian-security|https://archive.debian.org/debian-security|g' \
           -e 's|http://deb.debian.org/debian-security|https://archive.debian.org/debian-security|g' \
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
# [M-18] Runtime base image digest-pinned (see build-stage note). The nginx:1.23-alpine
# tag floats; the @sha256 pin freezes the exact multi-arch index. Digest resolved from
# Docker Hub (docker manifest inspect / RepoDigests) for nginx:1.23-alpine.
FROM nginx:1.23-alpine@sha256:02ffd439b71d9ea9408e449b568f65c0bbbb94bebd8750f1d80231ab6496008e
LABEL maintainer="support@taiga.io"

# bash is required at container start by /docker-entrypoint.d/30_config_env_subst.sh,
# a #!/bin/bash script that uses arrays; the nginx:alpine base ships only BusyBox sh.
RUN apk add --no-cache bash

COPY docker/default.conf /etc/nginx/conf.d/default.conf
COPY docker/conf.json.template /usr/share/nginx/html/conf.json.template
COPY docker/config_env_subst.sh /docker-entrypoint.d/30_config_env_subst.sh
RUN chmod +x /docker-entrypoint.d/30_config_env_subst.sh

COPY --from=build /app/dist/ /usr/share/nginx/html/

# [M-19] Restore the Slack / GitHub-auth / GitLab-auth contrib front-end plugins.
# Both the original single-stage image (a17d8c9) and the Step-0 build-from-source image
# (8a73e14) delivered these three plugins into <html>/plugins/; the current rewrite had
# dropped them, regressing deployments that enable Slack notifications or GitHub/GitLab
# OAuth login. They are re-added from the same pinned upstream release archives (6.10.0),
# extracting each plugin's prebuilt front/dist/* into its own directory.
#
# Hardening vs. the legacy block: (1) all three archives are fetched over HTTPS — the
# legacy block used http:// for github-auth/gitlab-auth; (2) the extraction path is
# WILDCARDED (taiga-contrib-*-*/front/dist/*) because the 6.10.0 archive expands to a
# 6.10.1-named top-level directory — the legacy hardcoded "-6.10.1/" path was a latent
# breakage waiting on any archive re-tag; (3) full wget/unzip/ca-certificates are
# installed in a virtual package set and removed afterward so the runtime image stays
# lean and carries no lingering fetch tooling.
RUN set -eux; \
    apk add --no-cache --virtual .plugin-deps wget unzip ca-certificates; \
    mkdir -p /usr/share/nginx/html/plugins; \
    cd /usr/share/nginx/html/plugins; \
    wget https://github.com/taigaio/taiga-contrib-slack/archive/6.10.0.zip -O source.zip; \
    unzip -j source.zip "taiga-contrib-slack-*/front/dist/*" -d slack; \
    rm source.zip; \
    wget https://github.com/taigaio/taiga-contrib-github-auth/archive/6.10.0.zip -O source.zip; \
    unzip -j source.zip "taiga-contrib-github-auth-*/front/dist/*" -d github-auth; \
    rm source.zip; \
    wget https://github.com/taigaio/taiga-contrib-gitlab-auth/archive/6.10.0.zip -O source.zip; \
    unzip -j source.zip "taiga-contrib-gitlab-auth-*/front/dist/*" -d gitlab-auth; \
    rm source.zip; \
    apk del .plugin-deps

# [N-08] Defense-in-depth: strip every JavaScript source map from the served tree.
# The gulp `esbuild` task already emits NO react-app.js.map on a deploy build (see
# gulpfile.js), but the surviving AngularJS pipeline can still copy app.js/vendor maps
# into dist/. A served .map embeds `sourcesContent` (the full un-minified source), so we
# guarantee none is web-reachable regardless of what the build stage produced.
RUN find /usr/share/nginx/html -type f -name '*.map' -delete
