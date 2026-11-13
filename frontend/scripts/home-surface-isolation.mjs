// Deliberately plain diagnostic skins. No dimensions, positioning, scroll, or renderer changes.
export const surfaceAddbackStyle = `
html[data-local-surface="background"] .home-background { mask-image:none!important; }
html[data-local-surface="background"] .home-background-effect { opacity:1!important; }
html[data-local-surface="background"] .home-background-shade { background:none!important; }
html[data-local-surface="stage"] .site-main .story-stage.island {
  background:#0d0f13!important; backdrop-filter:none!important;
  box-shadow:none!important; isolation:auto!important;
}
html[data-local-surface="stage"] .radar :is(.radar-map,.radar-canvas) { mask-image:none!important; }
`

export const surfaceIsolationStyle = `
html[data-local-surface="flat"] .home-background { mask-image:none!important; }
html[data-local-surface="flat"] .home-background-effect { opacity:1!important; }
html[data-local-surface="flat"] .home-background-shade { background:none!important; }
html[data-local-surface="flat"] .site-main .story-stage.island {
  background:#0d0f13!important; backdrop-filter:none!important;
  box-shadow:none!important; isolation:auto!important;
}
html[data-local-surface="flat"] .radar :is(.radar-map,.radar-canvas) { mask-image:none!important; }
`
