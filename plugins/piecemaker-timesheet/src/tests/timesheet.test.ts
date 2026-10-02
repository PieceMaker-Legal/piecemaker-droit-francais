import { describe, expect, it } from 'vitest';
import { formatDuration } from '../index.js';

describe('timesheet duration display', () => {
  it('formats active time in hours and minutes', () => {
    expect(formatDuration(3725)).toBe('1 h 02 min');
  });

  it('formats short sessions in minutes and seconds', () => {
    expect(formatDuration(125)).toBe('2 min 05 s');
  });

  it('does not display negative durations', () => {
    expect(formatDuration(-4)).toBe('0 s');
  });
});
