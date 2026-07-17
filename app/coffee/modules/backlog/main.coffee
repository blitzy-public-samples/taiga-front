###
# This source code is licensed under the terms of the
# GNU Affero General Public License found in the LICENSE file in
# the root directory of this source tree.
#
# Copyright (c) 2021-present Kaleidos INC
###

# Empty-module stub for the migrated Backlog screen.
#
# The Backlog / sprint-planning UI is now implemented in React
# (app/react/backlog/**, mounted via the <tg-react-backlog> custom element). All
# former BacklogController and tgBacklog* / sprint / lightbox directive logic has
# been removed from this file; only the AngularJS module reference required by
# `angular.module("taiga", modules)` [app/coffee/app.coffee L1106,
# "taigaBacklog" L1063] remains.
#
# The `taigaBacklog` module object itself is created (with its empty dependency
# list) by the module aggregator `app/coffee/modules/backlog.coffee`
# (`angular.module("taigaBacklog", [])`), and every feature file retrieves it
# with the one-argument accessor form — the same arrangement the upstream project
# has always used. The original `backlog/main.coffee` opened with
# `module = angular.module("taigaBacklog")`, and this stub preserves that
# retrieval form.
#
# The retrieval (one-argument) form also keeps the still-AngularJS screens
# working: `taskboard/sortable.coffee` registers onto `taigaBacklog` via the same
# accessor. Re-creating the module here (the two-argument form) would empty it and
# drop registrations those screens depend on.
angular.module("taigaBacklog")
