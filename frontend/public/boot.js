// Runs before first paint (an external file: the CSP allows scripts from 'self' only).
// .js and .motion gate the hidden-before-reveal styles, so content stays visible
// without JS and under reduced motion.
document.documentElement.classList.add('js')
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) document.documentElement.classList.add('motion')
