###
# This source code is licensed under the terms of the
# GNU Affero General Public License found in the LICENSE file in
# the root directory of this source tree.
#
# Copyright (c) 2021-present Kaleidos INC
###

window._version = "___VERSION___"

window.taigaConfig = {
    "api": "http://localhost:8000/api/v1/",
    "newsletterSubscriberUrl": "https://newsletter-subscriber.taiga.io",
    "eventsUrl": null,
    "tribeHost": null,
    "eventsMaxMissedHeartbeats": 5,
    "eventsHeartbeatIntervalTime": 60000,
    "debug": false,
    "defaultLanguage": "en",
    "themes": ["taiga", "taiga-legacy", "material-design", "high-contrast"],
    "defaultTheme": "taiga",
    "publicRegisterEnabled": true,
    "feedbackEnabled": true,
    "supportUrl": null,
    "privacyPolicyUrl": null,
    "termsOfServiceUrl": null,
    "maxUploadFileSize": null,
    "enableAsanaImporter": false,
    "enableGithubImporter": false,
    "enableJiraImporter": false,
    "enableTrelloImporter": false,
    "contribPlugins": [],
    "baseHref": "/"
}

window.taigaContribPlugins = []

window._decorators = []

window.addDecorator = (provider, decorator) ->
    window._decorators.push({provider: provider, decorator: decorator})

window.getDecorators = ->
    return window._decorators

loadStylesheet = (path) ->
    link = document.createElement('link')
    link.href = path
    link.type = 'text/css'
    link.rel = 'stylesheet'
    document.getElementsByTagName('head')[0].appendChild(link)

loadJS = (path) ->
    return new Promise (resolve, reject) ->
        script = document.createElement('script')
        script.type = 'text/javascript'
        script.src = path
        script.onload = resolve
        # QA M-02: the original `reject(err, s)` referenced an undefined `s`,
        # which threw a ReferenceError INSIDE the error handler and destroyed the
        # diagnostic (the real load failure was masked by the bogus reference).
        # Reject with a single, descriptive Error naming the failed asset so the
        # loadApp() chain can log a diagnosable message and degrade gracefully.
        script.onerror = (err) ->
            reject(new Error("Failed to load script: #{path}"))
        document.body.appendChild(script)

loadPlugin = (pluginPath) ->
    return new Promise (resolve, reject) ->
        success = (plugin) ->
            if plugin.isPack
                for item in plugin.plugins
                    window.taigaContribPlugins.push(item)
            else
                window.taigaContribPlugins.push(plugin)

            if plugin.css
                loadStylesheet(plugin.css)

            #dont' wait for css
            if plugin.js
                loadJS(plugin.js).then(resolve)
            else
                resolve()

        fail = (jqXHR, textStatus, errorThrown) ->
            console.error("Error loading plugin", pluginPath, errorThrown)

        fetch(pluginPath)
        .then((response) => response.json())
        .then(success, fail)

loadPlugins = (plugins) ->
    promises = []
    plugins.forEach (pluginPath) ->
        promises.push(loadPlugin(pluginPath))

    return Promise.all(promises)

mainLoad = ->
    emojisPromise = fetch("#{window._version}/emojis/emojis-data.json")
    .then((response) => response.json())
    .then (emojis) ->
        window.emojis = emojis
    if window.taigaConfig.contribPlugins.length > 0
        loadJS("#{window._version}/js/libs.js")
            .then(() => loadJS("#{window._version}/js/templates.js"))
            .then(() => loadPlugins(window.taigaConfig.contribPlugins))
            .then(() => loadApp(emojisPromise))
    else
        loadJS("#{window._version}/js/libs.js")
            .then(() => loadJS("#{window._version}/js/templates.js"))
            .then(() => loadApp(emojisPromise))

loadApp = (emojisPromise) ->
    # QA M-02: bootstrap resilience. The AAP requires the Web-Components bundle
    # (elements.js) and the React bundle (react.js) to be loaded BEFORE
    # angular.bootstrap, in that order (see §0.6.1). Both are OPTIONAL enhancement
    # bundles, though — only app.js is required for the AngularJS shell and every
    # legacy (non-migrated) screen. The original chain had NO error handling, so a
    # failure to load react.js (or elements.js) rejected the whole chain and
    # angular.bootstrap never ran, blanking the ENTIRE application. Here the two
    # optional bundles are loaded best-effort (log + continue on error) while the
    # load ORDER is preserved, so a missing/broken React bundle degrades to
    # "Kanban/Backlog unavailable" instead of a dead app. app.js remains mandatory;
    # if it (or the bootstrap itself) fails, a single diagnosable fatal error is
    # logged rather than failing silently.
    loadOptional = (path, label) ->
        loadJS(path).catch (err) ->
            msg = "[app-loader] Failed to load #{label} (#{path}). " +
                "The AngularJS application will still start; " +
                "features provided by #{label} will be unavailable."
            console.error(msg, err)
            return

    # Emoji data is cosmetic; guard it so a transient failure cannot block the
    # bootstrap (the original `emojisPromise.then` would have swallowed bootstrap
    # on an emoji-fetch rejection — the same class of blank-app bug as M-02).
    safeEmojis = emojisPromise.catch (err) ->
        console.error("[app-loader] Emoji data failed to load; continuing without it.", err)
        return

    loadOptional("#{window._version}/js/elements.js", "elements.js (Web Components)")
        .then(-> loadOptional("#{window._version}/js/react.js", "react.js (React Kanban/Backlog screens)"))
        .then(-> loadJS("#{window._version}/js/app.js"))
        .then(-> safeEmojis)
        .then(-> angular.bootstrap(document, ['taiga']))
        .catch (err) ->
            msg = "[app-loader] Failed to load the core application bundle " +
                "(app.js) or to bootstrap AngularJS; the application cannot start."
            console.error(msg, err)

# QA M-03: attach the fallback `.catch` to the END of the promise chain rather
# than to the raw `fetch` promise. The original `promise.catch(...)` was bound to
# the un-chained `fetch` result, so it only caught network/fetch rejections — a
# malformed conf.json that made `response.json()` throw produced an UNHANDLED
# rejection in the `.then(...).then(...)` branch and `mainLoad()` never ran,
# blanking the app. Chaining the catch here makes BOTH a failed fetch AND a
# JSON-parse error fall back to `mainLoad()`, which boots the application with the
# built-in default `window.taigaConfig`.
fetch("conf.json")
    .then((response) => response.json())
    .then (data) ->
        window.taigaConfig = Object.assign({}, window.taigaConfig, data)

        base = document.querySelector('base')

        if base && window.taigaConfig.baseHref
            base.setAttribute("href", window.taigaConfig.baseHref)
        else if !base && window.taigaConfig.baseHref
            base = document.createElement('base')
            base.setAttribute("href", window.taigaConfig.baseHref)
            document.head.appendChild(base)

        mainLoad()
    .catch (err) ->
        console.error("Your conf.json file is not a valid json file, please review it.", err)
        mainLoad()
