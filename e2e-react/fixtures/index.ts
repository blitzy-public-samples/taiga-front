/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

// Barrel for the React Kanban/Backlog Playwright e2e fixtures.
// Mirrors the e2e/helpers/index.js re-export convention.
// Consumed by ../tests/kanban.spec.ts and ../tests/backlog.spec.ts, e.g.:
//   import { test, expect, openKanban, openBacklog, screenshot } from '../fixtures';
export * from './common';
export * from './capture';
export * from './auth';
