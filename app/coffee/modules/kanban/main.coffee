###
# This source code is licensed under the terms of the
# GNU Affero General Public License found in the LICENSE file in
# the root directory of this source tree.
#
# Copyright (c) 2021-present Kaleidos INC
###

# QA finding [O]: use the one-arg RETRIEVE form, NOT the two-arg create form.
#
# The `taigaKanban` module is CREATED once by the aggregator
# `app/coffee/modules/kanban.coffee` (gulp concat position 6). The Angular
# Taskboard then registers services onto it via the retrieve form
# (`taskboard/taskboard-tasks.coffee` L157 `tgTaskboardTasks`,
# `taskboard/taskboard-issues.coffee` L81 `tgTaskboardIssues`; concat position 9),
# and `admin/lightboxes.coffee` (position 17) also retrieves it.
#
# This migrated stub is concatenated LAST among these (position 10). Using the
# two-arg create form `angular.module("taigaKanban", [])` here RE-CREATES and
# EMPTIES the module, wiping the Taskboard's already-registered services and
# producing `[$injector:unpr] Unknown provider: tgTaskboardTasksProvider` — a
# regression in the out-of-scope Angular Taskboard.
#
# The AAP's literal §0.4.1/§0.7.2 wording ("reduce to angular.module(\"taigaKanban\", [])")
# is superseded here by the AAP's controlling principle §0.2.2/§0.7.1 ("leave
# everything else unchanged" — the Taskboard MUST keep working). Retrieving the
# already-created module preserves `angular.module("taiga", modules)` resolution
# WITHOUT destroying the Taskboard's DI registrations.
angular.module("taigaKanban")
