// Scroll position <-> round time. Each anchor pins a round time to a scroll position (the
// hero at the top, each chapter when it reaches the reading line, the round's end when
// the story leaves); between anchors time runs linearly, so scrolling scrubs the round
// 1:1. Under reduced motion the radar steps: it holds each chapter's event frame.
export type Anchor = { y: number; t: number }

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
