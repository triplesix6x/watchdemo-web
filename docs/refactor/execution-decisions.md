# Execution decisions after the workflow review

## D28 — Autonomous completion and bounded parallel work

The operator authorized continued execution without further chat clarification.
Open decisions are made conservatively and recorded here for the final review.
Existing behavior, appearance, safety, local-branch and no-push constraints remain
binding. This does not authorize unrelated bug fixes or hidden visual changes.

- Independent source work runs in separate owned worktrees. The parent integrates
  changes and exclusively schedules resource-contained checks. Parallel reading
  and editing do not require parallel Cargo, browser or database execution.
- Complete the nearly finished D16 and D18 corrections separately. Do not expand
  them into persistence or publication framework rewrites.
- Keep unresolved visual determinism and native readiness as explicit gates, not
  an excuse to block unrelated exact-byte or comment-only work. Do not label a
  partial diagnostic, successful compilation or CLI exit zero as acceptance.
- Bound further infrastructure work to a concrete missing acceptance condition.
  Reuse existing coordinators; do not add another generic proof framework.
- Retain architecture when its state, ownership and recovery semantics justify
  it. A deletion quota is not an architectural objective. Comment cleanup must
  preserve contracts, directives, licensing, safety and ordering explanations.
- No further user questions are required for reversible implementation choices.
  Unsafe real-account, production-network, trust-store, Steam or deployment
  actions remain excluded; unresolved manual/physical checks must be reported.

## Current independently assigned lanes

D16 correctness and maintainability; Q0 cumulative prerequisite correctness and
maintainability; Rust comment cleanup; web Python comment cleanup; web frontend
comment cleanup; source-only homepage performance investigation. Implementation
lanes have disjoint ownership. Reviews do not write source. The final report must
state which module inspections and runtime checks actually occurred.

## D29 — Do not manufacture visual acceptance

D21 allows tolerance derived from unchanged-baseline repeats; it does not require
PNG container bytes to be identical. The current runner's zero-noise policy is
conservative but is not a complete calibrated acceptance model. An independent
source review confirmed that a per-pixel observed min/max envelope alone could
admit a stable shift or a spatial combination absent from all baseline images.
Three samples do not establish the distribution's support.

Keep unresolved repeat differences inconclusive. Do not silently introduce masks,
blur, percentages, an envelope-only pass or new rendering settings. UI-dependent
refactors remain gated. Image decoding and symmetric noise diagnostics may inform
a later investigation, but do not turn missing evidence into equivalence.

## D30 — Separate software-capture failure from product performance

Three bounded, guarded probes reused the same built homepage and fixtures:

| Renderer and clock | Fonts | Requests | Result |
| --- | --- | --- | --- |
| RX 5700 XT, no installed virtual clock | resolved, 1284.69 ms | 22 finished / 22 | responsive |
| RX 5700 XT, installed paused clock | resolved, 1248.96 ms | 22 finished / 22 | responsive |
| software renderer, no installed clock | 15009.15 ms deadline | 18 finished / 21; three in flight | unresolved stall |

The hardware renderer was identified as ANGLE AMD Radeon RX 5700 XT / Direct3D11.
No guard violations, failed HTTP responses or request failures occurred. The
contexts, browsers and owned server closed. Earlier software probes with installed
paused/running clocks also stalled, while the same-CSS, no-app control loaded.
These counterfactuals associate this QA failure with the software/full-app path;
they do not identify a particular shader, prove a mobile bottleneck or measure a
speedup. Timing values are readiness diagnostics, not comparative benchmarks.

Keep production graphics, clocks and font deadlines unchanged. Use real GPU for
performance as agreed, not as a replacement for the D26 canonical software gate.
Do not retain the three proposed source micro-optimizations without the required
whole-home gain and equivalence evidence. Physical phone checks remain deferred.
