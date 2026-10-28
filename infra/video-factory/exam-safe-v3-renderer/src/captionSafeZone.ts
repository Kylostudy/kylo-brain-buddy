// Conservative union of the six publishing platforms on a 1080x1920 frame.
export const CAPTION_SAFE_ZONE = { left: 65, right: 950, top: 231, bottom: 1459 };
export const CAPTION_LAYOUT = { left: 81, rightInset: 146, bottomInset: 490, maxHeight: 240 };
export function captionBounds() {
  return { left: CAPTION_LAYOUT.left, right: 1080 - CAPTION_LAYOUT.rightInset,
    top: 1920 - CAPTION_LAYOUT.bottomInset - CAPTION_LAYOUT.maxHeight,
    bottom: 1920 - CAPTION_LAYOUT.bottomInset + 14 };
}