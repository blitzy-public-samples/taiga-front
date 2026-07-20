/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit specs for the DnD drag-state class-name contract (F09 coverage, F41
 * visual parity).
 *
 * `DND_CLASS` centralizes the EXACT class names the React DnD primitives must
 * emit so the EXISTING compiled SCSS (kanban-table.scss, backlog-table.scss,
 * base.scss) renders the React screens unchanged. A typo here would silently
 * break visual parity, so the values are pinned by this spec.
 */

import { DND_CLASS } from '../types';

describe('DND_CLASS — drag-state class names reproduced from the legacy SCSS', () => {
  it('pins every class name exactly as the AngularJS DnD applied it', () => {
    expect(DND_CLASS).toEqual({
      transit: 'gu-transit',
      transitMulti: 'gu-transit-multi',
      targetDrop: 'target-drop',
      mirror: 'multiple-drag-mirror',
      selected: 'ui-multisortable-multiple',
      moved: 'kanban-moved',
      newColumn: 'new',
      dragActive: 'drag-active',
    });
  });
});
