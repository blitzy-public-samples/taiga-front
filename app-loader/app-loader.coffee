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
        script.onerror = (err) ->
            # Reject with the error event only. The previous `reject(err, s)`
            # referenced an undeclared `s`, so evaluating the arguments threw
            # `ReferenceError: s is not defined` INSIDE the error handler before
            # reject() ran, leaving the promise pending forever instead of
            # rejecting. A pending (never-rejecting) load silently stalls the
            # whole bootstrap chain, so the rejection must be clean.
            reject(err)
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

# Verify that react-app.js actually registered BOTH migrated-board custom
# elements. The React bundle registers "tg-react-kanban" and "tg-react-backlog"
# on window.customElements as a top-level side effect (app/react/index.tsx); the
# Kanban and Backlog Jade shells only upgrade to React once those tags exist. A
# bundle that loaded but failed to register them would leave the boards inert,
# so surface an explicit diagnostic instead of failing silently.
verifyReactElements = ->
    registry = window.customElements

    if not registry
        console.error("Taiga: window.customElements is unavailable; the React Kanban/Backlog boards cannot register.")
        return

    tags = ["tg-react-kanban", "tg-react-backlog"]
    missing = (tag for tag in tags when not registry.get(tag))

    if missing.length > 0
        console.error("Taiga: react-app.js loaded but expected custom elements are not registered:", missing)

# Load the React bundle resiliently. react-app.js powers ONLY the two migrated
# screens (Kanban and Backlog), so a failure to load it must NEVER block
# angular.bootstrap: every other (non-migrated) AngularJS screen has to keep
# working. On failure we log an explicit diagnosis and resolve anyway, so the
# loadApp chain still continues to app.js and angular.bootstrap (graceful
# fallback). This preserves the required load order elements.js -> react-app.js
# -> app.js -> bootstrap while making the new React link non-fatal.
loadReactApp = ->
    loadJS("#{window._version}/js/react-app.js")
        .then(verifyReactElements)
        .catch (err) ->
            message = "react-app.js failed to load; the Kanban and Backlog boards will be " +
                "unavailable. Continuing AngularJS startup without them."
            console.error("Taiga: #{message}", err)
            return

loadApp = (emojisPromise) ->
    loadJS("#{window._version}/js/elements.js").then () ->
        loadReactApp().then () ->
            loadJS("#{window._version}/js/app.js").then () ->
                emojisPromise.then ->
                    angular.bootstrap(document, ['taiga'])

promise = fetch "conf.json"
promise
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

promise.catch () ->
    console.error "Your conf.json file is not a valid json file, please review it."
    mainLoad()
