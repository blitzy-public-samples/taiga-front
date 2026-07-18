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
    Backlog React screens. The primary browser is Firefox; Chromium is a
    fallback, launched with `--no-sandbox --disable-dev-shm-usage`. It requires
    the full Taiga stack running (`taiga-back` plus the built `taiga-front`
    served by nginx on host port 9000) and reads the login credential from the
    `TAIGA_ADMIN_PASSWORD` environment variable, falling back to `admin123`.

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

    The Protractor harness is retained; only the Kanban and Backlog suites were removed.
