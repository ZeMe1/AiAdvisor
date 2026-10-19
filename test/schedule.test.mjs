import { describe, it, expect } from 'vitest';
import {
  DAYS,
  SLOT_COUNT,
  slotStartLabel,
  slotEndLabel,
  slotIndexOf,
  cellsOf,
  markConflicts,
} from '../web/src/schedule.js';

describe('Schedule Utilities', () => {
  it('has 14 slots for days Mo through Sa', () => {
    expect(DAYS).toEqual(['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']);
    expect(SLOT_COUNT).toBe(14);
  });

  it('correctly calculates slot start and end labels (50-minute slots)', () => {
    // Slot 0: 08:30 -> 09:20 (previously had a bug where it showed 08:20!)
    expect(slotStartLabel(0)).toBe('08:30');
    expect(slotEndLabel(0)).toBe('09:20');

    // Slot 1: 09:30 -> 10:20
    expect(slotStartLabel(1)).toBe('09:30');
    expect(slotEndLabel(1)).toBe('10:20');

    // Slot 13: 21:30 -> 22:20
    expect(slotStartLabel(13)).toBe('21:30');
    expect(slotEndLabel(13)).toBe('22:20');
  });

  it('slotIndexOf maps times accurately to row index', () => {
    expect(slotIndexOf('08:30')).toBe(0);
    expect(slotIndexOf('09:30')).toBe(1);
    expect(slotIndexOf('14:30')).toBe(6);
    expect(slotIndexOf('21:30')).toBe(13);
    // Boundary clamping
    expect(slotIndexOf('05:00')).toBe(0);
    expect(slotIndexOf('23:00')).toBe(13);
  });

  it('cellsOf extracts day and row positions from section schedule', () => {
    const section = {
      schedule: [
        { day: 1, time: '08:30' }, // Monday (day 0), row 0
        { day: 3, time: '11:30' }, // Wednesday (day 2), row 3
      ],
    };
    expect(cellsOf(section)).toEqual([
      { day: 0, row: 0 },
      { day: 2, row: 3 },
    ]);
  });

  it('markConflicts detects overlapping slots from different courses', () => {
    const chips = [
      { code: 'CSS 101', day: 0, row: 0, label: 'CSS 101 [01-N]' },
      { code: 'INF 201', day: 0, row: 0, label: 'INF 201 [02-N]' }, // Conflict with CSS 101!
      { code: 'MDE 101', day: 1, row: 2, label: 'MDE 101 [01-N]' }, // No conflict
    ];

    const result = markConflicts(chips);
    expect(result[0].conflict).toBe(true);
    expect(result[1].conflict).toBe(true);
    expect(result[2].conflict).toBeUndefined();
  });

  it('markConflicts does NOT flag conflict if chips belong to the same course', () => {
    const chips = [
      { code: 'CSS 101', day: 0, row: 0, label: 'CSS 101 [01-N]' },
      { code: 'CSS 101', day: 0, row: 0, label: 'CSS 101 [02-N]' }, // Same course (draft replacement)
    ];

    const result = markConflicts(chips);
    expect(result[0].conflict).toBeUndefined();
    expect(result[1].conflict).toBeUndefined();
  });
});
