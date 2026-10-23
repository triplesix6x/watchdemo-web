// Media queries and the shared easing names. Safe to import on the server: nothing runs
// at import time.
const mq = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches

export const prefersReducedMotion = () => mq('(prefers-reduced-motion: reduce)')
export const isTouch = () => mq('(hover: none), (pointer: coarse)')
export const isMobile = () => mq('(max-width: 767px)')

// One easing vocabulary. CSS uses the spring tokens (--ease-spring*); GSAP uses these.
// "Scrub and settle": scrubbed tweens use ease 'none' (1:1 with input), everything that
// settles uses `settle`, close to the app's critically damped spring.
export const ease = {
  settle: 'expo.out', // entrances, the end of a scrub, the curtain opening
  inOut: 'power3.inOut', // the curtain closing
  soft: 'power3.out', // small UI
  spring: 'back.out(1.4)', // after a gesture with momentum only
} as const
