## Taiga Front

[![Managed with Taiga.io](https://img.shields.io/badge/managed%20with-TAIGA.io-709f14.svg)](https://tree.taiga.io/project/taiga/ "Managed with Taiga.io")
[![Build Status](https://img.shields.io/travis/taigaio/taiga-front.svg)](https://travis-ci.org/taigaio/taiga-front "Build Status")

## Get the compiled version

You can get the compiled version of this code in the
[taiga-front-dist](http://github.com/taigaio/taiga-front-dist) repository

## Documentation

Currently, we have authored three main documentation hubs:

-   **[API](https://docs.taiga.io/api.html)**: Our API documentation and reference for developing from Taiga API.
-   **[Documentation](https://docs.taiga.io/)**: If you need to install Taiga on your own server, this is the place to find some guides.
-   **[Taiga Community](https://community.taiga.io/)**: This page is intended to be the support reference page for the users.

## Bug reports

If you **find a bug** in Taiga you can always report it:

-   in [Taiga issues](https://tree.taiga.io/project/taiga/issues). **This is the preferred way**
-   in [Github issues](https://github.com/taigaio/taiga-front/issues)
-   send us a mail to support@taiga.io if is a bug related to [tree.taiga.io](https://tree.taiga.io)
-   send us a mail to security@taiga.io if is a **security bug**.

One of our fellow Taiga developers will search, find and hunt it as soon as possible.

Please, before reporting a bug, write down how can we reproduce it, your operating system, your browser and version, and if it's possible, a screenshot. Sometimes it takes less time to fix a bug if the developer knows how to find it.

## Community

If you **need help to setup Taiga**, want to **talk about some cool enhancement** or you have **some questions**, please go to [Taiga community](https://community.taiga.io/).

If you want to be up to date about announcements of releases, important changes and so on, you can subscribe to our newsletter (you will find it by scrolling down at [https://taiga.io](https://www.taiga.io/)) and follow [@taigaio](https://twitter.com/taigaio) on Twitter.

## Contribute to Taiga

There are many different ways to contribute to Taiga's platform, from patches, to documentation and UI enhancements, just find the one that best fits with your skills. Check out our detailed [contribution guide](https://community.taiga.io/t/how-can-i-contribute/159)

## Code of Conduct

Help us keep the Taiga Community open and inclusive. Please read and follow our [Code of Conduct](https://github.com/taigaio/code-of-conduct/blob/main/CODE_OF_CONDUCT.md).

## License

Every code patch accepted in this repository is licensed under [AGPL 3.0](LICENSE). You must be careful to not include any code that can not be licensed under this license.

Please read carefully [our license](LICENSE) and ask us if you have any questions as well as the [Contribution policy](https://github.com/taigaio/taiga-front/blob/main/CONTRIBUTING.md).

## Initial dev env

Install requirements:

**Node + Gulp**

We recommend using [nvm](https://github.com/creationix/nvm) to manage different node versions

```
npm start
```

And go in your browser to: http://localhost:9001/

#### E2E test

If you want to run e2e tests

```
npm install -g protractor
npm install -g mocha
npm install -g babel@5

webdriver-manager update
```

To run a local Selenium Server, you will need to have the Java Development Kit (JDK) installed.

## Tests

The migrated Kanban and Backlog screens are React 18; every other screen is still AngularJS. Each stack keeps its own runner, so there is a React test layer and a retained legacy layer for both unit and e2e tests.

#### Unit tests

-   To run the **React unit tests**

    ```
    npm test
    ```

    `npm test` runs [Jest](https://jestjs.io/) against the React specs under
    `app/react/**/__tests__/**` in a `jsdom` environment. It is browserless and
    needs no running backend, no Playwright, and no Chrome or network access.

-   To run the **legacy Karma unit tests** for the other (non-migrated) AngularJS screens

    ```
    npm run ci:test
    ```

    The 106 legacy Karma specs and the Karma configuration are retained
    unchanged. You can also build the assets separately with:

    ```
    npx gulp
    ```

#### E2E tests

-   To run the **React e2e tests** with [Playwright](https://playwright.dev/)

    ```
    npm run e2e
    ```

    `npm run e2e` runs the Playwright project in `e2e-react/` (configuration
    `e2e-react/playwright.config.ts`), which captures the migrated Kanban and
    Backlog React screens. **Firefox is the sole default engine** — a plain
    `npm run e2e` runs Firefox only. Chromium is a **separate, opt-in fallback**
    (for when Firefox is unavailable), run via its own command:

    ```
    npm run e2e:chromium
    ```

    which sets `TAIGA_E2E_CHROMIUM=1` and launches Chromium with
    `--no-sandbox --disable-dev-shm-usage` (a container's small `/dev/shm`
    otherwise crashes Chrome at startup). The default run never launches both
    engines at once, keeping the primary before/after evidence single-engine and
    deterministic.

    On a clean host, provision the Playwright browser once before the first run
    with `npx playwright install firefox` (Firefox is the primary engine; add
    `chromium` if you intend to use the opt-in fallback).

    The e2e layer requires the full Taiga stack running (`taiga-back` plus the
    built `taiga-front` served by nginx on host port 9000). It reads the login
    credential from the `TAIGA_ADMIN_PASSWORD` environment variable, falling back
    to the documented dev default (see the setup instructions); the value is
    never embedded in the specs or fixtures.

    **Visual evidence** (before/after) is committed under
    `e2e-react/artifacts/{baseline,react}/` — curated screenshots, seed-data
    fingerprints, and manifests. Captures are **non-mutating** (lightboxes are
    opened then cancelled, drags are released at their origin, deletes are
    dismissed) so the seed-once database is preserved byte-for-byte identical
    across both passes; see `e2e-react/artifacts/README.md` for the two-phase
    workflow, the fingerprint proof, and the secret-free artifact policy
    (tracing is disabled, no traces/videos are committed). The specs use
    phase-aware selectors so the baseline pass targets the AngularJS DOM and the
    React pass targets the migrated React DOM.

    **Live-stack runtime validation** (post-migration): after the Docker image is
    rebuilt from source and the stack is up on port 9000, validate the migrated
    runtime by loading both real React routes — `/project/<slug>/kanban` and
    `/project/<slug>/backlog` — and confirming: the screens render, `/api/v1/`
    network calls carry the `Authorization: Bearer` and `X-Session-Id` headers,
    the browser console is free of errors, no detached-node memory leak occurs on
    unmount, and the ARIA roles added by the migration are present. Then run the
    `CAPTURE_PHASE=react` pass to produce the `artifacts/react/` evidence set.

-   To run the **legacy Protractor e2e tests** for the remaining screens you need [taiga-back](https://github.com/taigaio/taiga-back) running and

    ```
    npx gulp
    ```

    ```
    webdriver-manager start
    ```

    ```
    protractor conf.e2e.js --suite=auth     # To tests authentication
    protractor conf.e2e.js --suite=full     # To test all the platform authenticated
    ```

    The Protractor harness (`conf.e2e.js`, `run-e2e.js`) and the 16 remaining
    screen suites and their helpers are retained unchanged. Only the two migrated
    suites — `e2e/suites/kanban.e2e.js` and `e2e/suites/backlog.e2e.js` — and
    their now-orphaned helpers were removed, with the matching re-exports dropped
    from `e2e/helpers/index.js` and the target mappings retired from
    `conf.e2e.js` / `run-e2e.js`. Those two screens are now covered by the React
    Playwright layer above.
