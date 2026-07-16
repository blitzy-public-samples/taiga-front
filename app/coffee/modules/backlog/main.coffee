###
# This source code is licensed under the terms of the
# GNU Affero General Public License found in the LICENSE file in
# the root directory of this source tree.
#
# Copyright (c) 2021-present Kaleidos INC
###

# QA finding [O]: use the one-arg RETRIEVE form, NOT the two-arg create form.
#
# The `taigaBacklog` module is CREATED once by the aggregator
# `app/coffee/modules/backlog.coffee` (gulp concat position 6). The Angular
# Taskboard's drag-and-drop helper registers onto it via the retrieve form
# (`taskboard/sortable.coffee` L17 `angular.module("taigaBacklog")`; concat
# position 9), which sits AFTER this migrated stub's aggregator but BEFORE any
# re-creation would matter.
#
# This migrated stub is concatenated at position 8. Using the two-arg create
# form `angular.module("taigaBacklog", [])` here RE-CREATES and EMPTIES the
# module, wiping registrations the still-Angular screens depend on. Mirroring the
# Kanban stub fix, we RETRIEVE the already-created module so
# `angular.module("taiga", modules)` resolution is preserved WITHOUT destroying
# any DI registrations. (AAP §0.2.2/§0.7.1 "leave everything else unchanged"
# controls over the literal §0.4.1/§0.7.2 two-arg wording.)
angular.module("taigaBacklog")
