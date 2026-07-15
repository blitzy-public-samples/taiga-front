/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit specs for the `@dnd-kit` sensor configuration (F09 coverage, F24 parity).
 *
 * These assert the pointer-only sensor contract that reproduces the legacy
 * `dragula` "press-then-move" drag start, and — critically — that NO keyboard
 * sensor is configured (the legacy drakes were pointer-only, so keyboard drag
 * would be a NEW interaction that violates exact behavioral parity, F24).
 */

import { renderHook } from '@testing-library/react';
import { PointerSensor, KeyboardSensor } from '@dnd-kit/core';
import { POINTER_ACTIVATION_CONSTRAINT, useDndSensors } from '../sensors';

describe('POINTER_ACTIVATION_CONSTRAINT', () => {
  it('is a 5px distance constraint (reproduces dragula move-to-start)', () => {
    expect(POINTER_ACTIVATION_CONSTRAINT).toEqual({ distance: 5 });
  });
});

describe('useDndSensors (F24 — pointer-only, no keyboard DnD)', () => {
  it('configures EXACTLY one sensor', () => {
    const { result } = renderHook(() => useDndSensors());
    expect(result.current).toHaveLength(1);
  });

  it('configures a PointerSensor carrying the 5px activation constraint', () => {
    const { result } = renderHook(() => useDndSensors());
    const [descriptor] = result.current;
    expect(descriptor.sensor).toBe(PointerSensor);
    expect(descriptor.options).toEqual({
      activationConstraint: POINTER_ACTIVATION_CONSTRAINT,
    });
  });

  it('does NOT configure a KeyboardSensor (no keyboard drag — parity, F24)', () => {
    const { result } = renderHook(() => useDndSensors());
    expect(result.current.some((d) => d.sensor === KeyboardSensor)).toBe(false);
  });

  it('keys on the stable PointerSensor CLASS reference across re-renders', () => {
    // DndContext installs its pointer listener once because it keys its setup
    // effect on the sensor CLASS (a module-stable reference), NOT on the array
    // identity. Assert the class stability our code actually guarantees.
    const { result, rerender } = renderHook(() => useDndSensors());
    const firstSensorClass = result.current[0].sensor;
    rerender();
    expect(result.current[0].sensor).toBe(firstSensorClass);
    expect(result.current[0].sensor).toBe(PointerSensor);
  });
});
