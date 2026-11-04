import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { horizontalWheelDelta } from './horizontalWheel';

// A chip row 300px wide holding 900px of chips.
const row = { scrollLeft: 100, scrollWidth: 900, clientWidth: 300 };
const wheel = (deltaY: number, deltaX = 0, deltaMode = 0) => ({
  deltaX,
  deltaY,
  deltaMode,
});

describe('horizontalWheelDelta', () => {
  it('turns a vertical wheel into a sideways scroll', () => {
    assert.equal(horizontalWheelDelta(wheel(40), row), 40);
    assert.equal(horizontalWheelDelta(wheel(-40), row), -40);
  });

  it('leaves a mostly sideways gesture to the browser', () => {
    assert.equal(horizontalWheelDelta(wheel(5, 30), row), null);
  });

  it("leaves the wheel alone when the row doesn't overflow", () => {
    assert.equal(
      horizontalWheelDelta(wheel(40), {
        scrollLeft: 0,
        scrollWidth: 300,
        clientWidth: 300,
      }),
      null
    );
  });

  it('lets the panel scroll once the row reaches either end', () => {
    assert.equal(
      horizontalWheelDelta(wheel(40), { ...row, scrollLeft: 600 }),
      null
    );
    assert.equal(
      horizontalWheelDelta(wheel(-40), { ...row, scrollLeft: 0 }),
      null
    );
  });

  it('converts a line-based wheel to pixels', () => {
    assert.equal(horizontalWheelDelta(wheel(3, 0, 1), row), 48);
  });
});
