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
        # F25: the previous handler called `reject(err, s)` with an undeclared
        # `s`; evaluating `s` threw a ReferenceError *inside* this callback, so
        # `reject` never actually ran and a failed/missing script silently hung
        # the entire boot. Reject with a real Error naming the offending path so
        # the boot chain can surface an actionable fatal diagnostic instead of
        # hanging forever.
        script.onerror = ->
            reject(new Error("Failed to load required script: #{path}"))
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

# The two React-backed custom elements that `react.js` registers at load time
# (see app/react/index.tsx). `angular.bootstrap` must not run until BOTH tags
# are defined; otherwise the kanban.jade / backlog.jade route templates would
# compile undefined <tg-react-*> hosts on every visit to those routes.
REACT_ELEMENT_TAGS = ['tg-react-kanban', 'tg-react-backlog']

# F25: returns the subset of REACT_ELEMENT_TAGS that are NOT registered in the
# custom-element registry. An empty array means every required tag is defined.
# A missing/degraded registry (a very old browser, or `customElements` stripped
# from the runtime) is treated as "all tags missing" so callers fail closed
# rather than booting a client whose migrated screens can never render.
missingReactElements = ->
    registry = window.customElements
    return REACT_ELEMENT_TAGS.slice() unless registry? and typeof registry.get is "function"
    return (tag for tag in REACT_ELEMENT_TAGS when not registry.get(tag)?)

# F25: fatal, human-visible boot diagnostic. Any failure in the mandatory boot
# chain — a missing/corrupt bundle, a bundle served as an HTML 200 SPA fallback
# that never registered its tags, or a thrown `angular.bootstrap` — is fatal:
# continuing to bootstrap would leave EVERY route (not just Kanban/Backlog)
# running against a broken client. Instead of the previous silent blank page,
# log the reason and render a single, idempotent alert banner. This function
# never re-throws and never advances the boot.
bootFatal = (reason) ->
    detail = (reason and reason.message) or reason or "unknown startup failure"
    console.error("Taiga failed to start: #{detail}")
    try
        return unless document? and document.body?
        return if document.getElementById("taiga-boot-error")?
        banner = document.createElement("div")
        banner.id = "taiga-boot-error"
        banner.setAttribute("role", "alert")
        banner.style.cssText = "position:fixed;top:0;left:0;right:0;" +
            "z-index:2147483647;padding:16px;font-family:sans-serif;" +
            "font-size:14px;line-height:1.4;background:#c0392b;" +
            "color:#fff;text-align:center;"
        banner.textContent = "Taiga could not be loaded. Please reload the " +
            "page; if the problem persists, contact your administrator."
        document.body.appendChild(banner)
    catch domErr
        console.error("Taiga boot error banner could not be rendered", domErr)
    return

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
            .catch((err) -> bootFatal(err))
    else
        loadJS("#{window._version}/js/libs.js")
            .then(() => loadJS("#{window._version}/js/templates.js"))
            .then(() => loadApp(emojisPromise))
            .catch((err) -> bootFatal(err))

loadApp = (emojisPromise) ->
    # Flat, catch-terminated boot chain (F25). The order is unchanged from the
    # original nesting — elements.js -> react.js -> app.js -> angular.bootstrap
    # — but every step is now sequenced with a single failure funnel so a
    # missing/corrupt bundle can no longer hang or silently advance the boot.
    loadJS("#{window._version}/js/elements.js")
    .then ->
        # React bundle hosting the migrated Kanban/Backlog Web Components
        # (tg-react-kanban / tg-react-backlog). Loaded before app.js so
        # customElements.define(...) completes before angular.bootstrap.
        loadJS("#{window._version}/js/react.js")
    .then ->
        # F25: assert BOTH custom elements actually registered before advancing.
        # If react.js was missing, corrupt, or served as an HTML 200 SPA
        # fallback, the <script> can report onload while customElements.define
        # never ran; booting AngularJS in that state would silently break the
        # migrated routes for every user. Fail closed instead of advancing.
        missing = missingReactElements()
        if missing.length > 0
            throw new Error("React coexistence bundle did not register: #{missing.join(', ')}")
        loadJS("#{window._version}/js/app.js")
    .then ->
        emojisPromise.then ->
            angular.bootstrap(document, ['taiga'])
    .catch (err) ->
        bootFatal(err)

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
