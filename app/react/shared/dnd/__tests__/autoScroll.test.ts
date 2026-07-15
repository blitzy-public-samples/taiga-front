/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit specs for the DnD auto-scroll mapping (F09 coverage, F25 definitive map).
 *
 * These assert BOTH the verbatim `dom-autoscroller` source values AND the
 * DEFINITIVE `@dnd-kit` mapped options, plus the parity invariants that the
 * pixel->ratio mapping is designed to preserve (kanban edge zone > backlog;
 * backlog acceleration > kanban; both pointer-activated). The invariants are
 * asserted here — NOT deferred to a later parity run (F25).
 */

import { AutoScrollActivator } from '@dnd-kit/core';
import {
  BACKLOG_AUTOSCROLL,
  BACKLOG_AUTOSCROLL_CONFIG,
  KANBAN_AUTOSCROLL,
  KANBAN_AUTOSCROLL_CONFIG,
  getAutoScrollOptions,
} from '../autoScroll';

describe('original dom-autoscroller source values (verbatim)', () => {
  it('reproduces the Kanban column config (kanban/sortable.coffee:155-160)', () => {
    expect(KANBAN_AUTOSCROLL_CONFIG).toEqual({ margin: 100, scrollWhenOutside: true });
  });

  it('reproduces the Backlog window config (backlog/sortable.coffee:145-151)', () => {
    expect(BACKLOG_AUTOSCROLL_CONFIG).toEqual({
      margin: 20,
      pixels: 30,
      scrollWhenOutside: true,
    });
  });
});

describe('DEFINITIVE @dnd-kit mapped options (F25)', () => {
  it('maps the Kanban options (larger edge zone, default speed, pointer)', () => {
    expect(KANBAN_AUTOSCROLL).toEqual({
      enabled: true,
      activator: AutoScrollActivator.Pointer,
      threshold: { x: 0.2, y: 0.2 },
      acceleration: 10,
    });
  });

  it('maps the Backlog options (vertical-only, faster speed, pointer)', () => {
    expect(BACKLOG_AUTOSCROLL).toEqual({
      enabled: true,
      activator: AutoScrollActivator.Pointer,
      threshold: { x: 0.0, y: 0.1 },
      acceleration: 30,
    });
  });
});

describe('parity invariants (asserted, not deferred — F25)', () => {
  it('keeps a LARGER edge zone on Kanban than on Backlog', () => {
    expect(KANBAN_AUTOSCROLL.threshold!.y).toBeGreaterThan(BACKLOG_AUTOSCROLL.threshold!.y);
  });

  it('scrolls FASTER on Backlog than on Kanban', () => {
    expect(BACKLOG_AUTOSCROLL.acceleration!).toBeGreaterThan(KANBAN_AUTOSCROLL.acceleration!);
  });

  it('has NO horizontal scroll on the Backlog (window scrolls vertically only)', () => {
    expect(BACKLOG_AUTOSCROLL.threshold!.x).toBe(0);
  });

  it('activates both screens by POINTER (~ scrollWhenOutside: true)', () => {
    expect(KANBAN_AUTOSCROLL.activator).toBe(AutoScrollActivator.Pointer);
    expect(BACKLOG_AUTOSCROLL.activator).toBe(AutoScrollActivator.Pointer);
  });
});

describe('getAutoScrollOptions', () => {
  it('returns the Kanban constant BY REFERENCE for mode "kanban"', () => {
    expect(getAutoScrollOptions('kanban')).toBe(KANBAN_AUTOSCROLL);
  });

  it('returns the Backlog constant BY REFERENCE for mode "backlog"', () => {
    expect(getAutoScrollOptions('backlog')).toBe(BACKLOG_AUTOSCROLL);
  });
});
