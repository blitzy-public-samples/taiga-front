# This source code is licensed under the terms of the
# GNU Affero General Public License found in the LICENSE file in
# the root directory of this source tree.
#
# Copyright (c) 2021-present Kaleidos INC

# ---------------------------------------------------------------------------
# Stage 1 - build the Taiga frontend from local source.
#
# Node is pinned to match .nvmrc (v16.19.1). The FULL Debian-based image is used
# on purpose (NOT -alpine / -slim): the build compiles node-sass / gulp-sass
# native addons, which require a node-gyp toolchain (python, make, g++) that the
# full image already ships. `npm ci` installs BOTH dependencies and
# devDependencies (gulp, coffeescript, gulp-jade, gulp-sass, node-sass, esbuild,
# typescript) that `gulp deploy` needs.
#
# NOTE: this stage relies on a source-permissive .dockerignore at the taiga-front
# root so package.json / package-lock.json / gulpfile.js / app/ / app-loader/ /
# elements.js / conf/ / etc. reach the build context. The stock .dockerignore
# excludes everything but docker/*, which MUST be relaxed for this build to work.
# ---------------------------------------------------------------------------
FROM node:16.19.1 AS build

WORKDIR /app

# Install dependencies first so this layer is cached across source-only changes.
# `npm ci` is strict: package-lock.json must be in sync with package.json (the
# lock is regenerated when the React / esbuild / TypeScript deps are added).
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the submodule source (node_modules/, dist/, tmp/, .git are
# excluded by .dockerignore).
COPY . .

# Compile CoffeeScript/Jade/SCSS AND run the new `react-screens` esbuild task,
# emitting the versioned dist/ (dist/index.html + dist/v-<ts>/js/{elements.js,
# react-screens.js, app.js, libs.js, templates.js} + themes/svg/fonts/images).
RUN npx gulp deploy

# ---------------------------------------------------------------------------
# Stage 2 - serve the freshly built dist/ with nginx (mirrors the original
# serving setup: same base image, same config files, same contrib plugins).
# ---------------------------------------------------------------------------
FROM nginx:1.23-alpine
LABEL maintainer="support@taiga.io"

COPY docker/default.conf /etc/nginx/conf.d/default.conf
COPY docker/config_env_subst.sh /docker-entrypoint.d/30_config_env_subst.sh

# Serve the locally built frontend. This REPLACES the previous download/unzip of
# the prebuilt taiga-front-dist tarball, so the versioned js/react-screens.js is
# now served and app-loader.coffee's loadJS can resolve it. The ENTIRE dist/ tree
# is copied (top-level index.html + the v-<ts>/ subfolder) into the web root.
COPY --from=build /app/dist/ /usr/share/nginx/html

# Place the runtime config template next to the served files (copied AFTER the
# dist/ tree so it cannot be shadowed) so the unchanged entrypoint
# (config_env_subst.sh) can envsubst it into /usr/share/nginx/html/conf.json and
# rewrite <base href> in index.html.
COPY docker/conf.json.template /usr/share/nginx/html/conf.json.template

RUN set -eux; \
    chmod +x /docker-entrypoint.d/30_config_env_subst.sh; \
    apk update; \
    apk add --no-cache --virtual .build-deps \
       subversion; \
    apk add \
       bash; \
    # Install taiga-front contribs (separate repos - NOT part of local source)
    mkdir -p /usr/share/nginx/html/plugins; \
    cd /usr/share/nginx/html/plugins; \
    # Slack
    wget https://github.com/taigaio/taiga-contrib-slack/archive/6.10.0.zip -O source.zip; \
    unzip -j source.zip "taiga-contrib-slack-6.10.1/front/dist/*" -d slack; \
    rm source.zip; \
    # Github
    wget http://github.com/taigaio/taiga-contrib-github-auth/archive/6.10.0.zip -O source.zip; \
    unzip -j source.zip "taiga-contrib-github-auth-6.10.1/front/dist/*" -d github-auth; \
    rm source.zip; \
    # Gitlab
    wget http://github.com/taigaio/taiga-contrib-gitlab-auth/archive/6.10.0.zip -O source.zip; \
    unzip -j source.zip "taiga-contrib-gitlab-auth-6.10.1/front/dist/*" -d gitlab-auth; \
    rm source.zip; \
    cd /; \
    # Remove unused build dependencies
    apk del --no-cache .build-deps
