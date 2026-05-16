import { describe, expect, it } from 'vitest';
import { positionContextMenu, positionFilterMenu } from '../src/renderer/menuPosition';

describe('menu positioning', () => {
  it('opens the context menu upward when the cursor is near the bottom edge', () => {
    const position = positionContextMenu({ x: 120, y: 598 }, { width: 800, height: 600 });

    expect(position.y).toBe(414);
  });

  it('keeps the context menu inside the right edge and opens submenus to the left', () => {
    const position = positionContextMenu({ x: 790, y: 120 }, { width: 800, height: 600 });

    expect(position.x).toBe(580);
    expect(position.submenuSide).toBe('left');
  });

  it('clamps filter menus to the viewport when there is no room below', () => {
    const position = positionFilterMenu({ left: 760, top: 570, bottom: 594 }, { width: 800, height: 600 });

    expect(position).toEqual({ x: 492, y: 266 });
  });
});
