// Ambient decoration does not need to submit WebGL work at 120/144 Hz.
// This gate does not own a clock: the radar/story retain the shared GSAP cadence.
export function createAmbientCadence() {
  const intervalMs = 1000 / 60
  // Allow small rAF timestamp jitter without accidentally halving a 60 Hz display.
  const toleranceMs = 0.5
  let deadline: number | null = null

  return {
    accept(now: number): boolean {
      if (deadline !== null && now + toleranceMs < deadline) return false
      // Keep phase on high-refresh displays, but never catch up after interruption.
      deadline = deadline === null || now - deadline > intervalMs
        ? now + intervalMs
        : deadline + intervalMs
      return true
    },
    reset(): void {
      deadline = null
    },
  }
}
