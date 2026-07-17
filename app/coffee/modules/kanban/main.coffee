###
# This source code is licensed under the terms of the
# GNU Affero General Public License found in the LICENSE file in
# the root directory of this source tree.
#
# Copyright (c) 2021-present Kaleidos INC
###

# Empty-module stub for the migrated Kanban screen.
#
# The Kanban board UI is now implemented in React (app/react/kanban/**, mounted
# via the <tg-react-kanban> custom element). All former KanbanController and
# tgKanban* directive logic has been removed from this file; only the AngularJS
# module reference required by `angular.module("taiga", modules)`
# [app/coffee/app.coffee L1106, "taigaKanban" L1065] remains.
#
# The `taigaKanban` module object itself is created (with its empty dependency
# list) by the module aggregator `app/coffee/modules/kanban.coffee`
# (`angular.module("taigaKanban", [])`). This is the same two-file arrangement
# the upstream project has always used: the aggregator creates the module and
# each feature file retrieves it with the one-argument accessor form. The
# original `kanban/main.coffee` opened with `module = angular.module("taigaKanban")`
# for exactly this reason, and this stub preserves that retrieval form.
#
# The retrieval (one-argument) form is also what keeps the still-AngularJS
# Taskboard working: `taskboard/taskboard-tasks.coffee` and
# `taskboard/taskboard-issues.coffee` register the `tgTaskboardTasks` /
# `tgTaskboardIssues` services onto `taigaKanban`, and `admin/lightboxes.coffee`
# retrieves it. Those files are concatenated ahead of this one, so re-creating
# the module here (the two-argument form) would empty it and drop those already
# registered services (`[$injector:unpr] Unknown provider: tgTaskboardTasksProvider`).
angular.module("taigaKanban")
