export type MenuSide = 'left' | 'right';

export type ViewportSize = {
  width: number;
  height: number;
};

export type MenuPoint = {
  x: number;
  y: number;
};

export type ContextMenuPosition = MenuPoint & {
  submenuSide: MenuSide;
};

export type AnchorRect = {
  left: number;
  top: number;
  bottom: number;
};

const viewportMargin = 8;
const filterMenuWidth = 300;
const filterMenuMaxHeight = 300;
const contextMenuWidth = 210;
const contextMenuHeight = 178;
const contextSubmenuWidth = 190;

export function positionContextMenu(anchor: MenuPoint, viewport: ViewportSize): ContextMenuPosition {
  const maxX = Math.max(viewportMargin, viewport.width - contextMenuWidth - viewportMargin);
  const maxY = Math.max(viewportMargin, viewport.height - contextMenuHeight - viewportMargin);
  const preferredX = anchor.x + contextMenuWidth <= viewport.width - viewportMargin
    ? anchor.x
    : anchor.x - contextMenuWidth;
  const preferredY = anchor.y + contextMenuHeight <= viewport.height - viewportMargin
    ? anchor.y
    : anchor.y - contextMenuHeight;
  const x = clamp(preferredX, viewportMargin, maxX);
  const y = clamp(preferredY, viewportMargin, maxY);
  const hasRoomOnRight = x + contextMenuWidth + contextSubmenuWidth <= viewport.width - viewportMargin;
  const hasRoomOnLeft = x - contextSubmenuWidth >= viewportMargin;

  return {
    x,
    y,
    submenuSide: hasRoomOnRight || !hasRoomOnLeft ? 'right' : 'left'
  };
}

export function positionFilterMenu(rect: AnchorRect, viewport: ViewportSize): MenuPoint {
  const maxX = Math.max(viewportMargin, viewport.width - filterMenuWidth - viewportMargin);
  const maxY = Math.max(viewportMargin, viewport.height - filterMenuMaxHeight - viewportMargin);
  const belowY = rect.bottom + 4;
  const aboveY = rect.top - filterMenuMaxHeight - 4;
  const hasRoomBelow = belowY + filterMenuMaxHeight <= viewport.height - viewportMargin;

  return {
    x: clamp(rect.left, viewportMargin, maxX),
    y: hasRoomBelow ? belowY : clamp(aboveY, viewportMargin, maxY)
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
