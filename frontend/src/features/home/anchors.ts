// Scroll position <-> round time, measured in document coordinates. The episode can
// follow content of any height; time zero belongs to its start, not the page's top.
export type Anchor = { y: number; t: number }

export function episodeAnchors(start: number, chapters: Anchor[], end: number, duration: number): Anchor[] {
  const anchors: Anchor[] = [{ y: Math.max(0, start), t: 0 }]
  for (const chapter of chapters) anchors.push({ y: Math.max(anchors[anchors.length - 1].y + 1, chapter.y), t: chapter.t })
  anchors.push({ y: Math.max(anchors[anchors.length - 1].y + 1, end), t: duration })
  return anchors
}

export function timeAt(anchors: Anchor[], y: number, step = false): number {
  if (y <= anchors[0].y) return anchors[0].t
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1]
    const b = anchors[i]
    if (y < b.y) return step ? a.t : a.t + ((b.t - a.t) * (y - a.y)) / (b.y - a.y)
  }
  return anchors[anchors.length - 1].t
}

export function scrollFor(anchors: Anchor[], t: number): number {
  if (t <= anchors[0].t) return anchors[0].y
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1]
    const b = anchors[i]
    if (t <= b.t) return a.y + ((b.y - a.y) * (t - a.t)) / (b.t - a.t)
  }
  return anchors[anchors.length - 1].y
}
