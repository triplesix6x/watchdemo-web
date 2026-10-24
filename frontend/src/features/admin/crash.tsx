// Pieces of the crash pages: the status pill and the stack of one report.
import type { CrashReportDetail, CrashStatus } from '../../api/types'
import { fmt } from '../../i18n'
import { Note, Pill, type PillTone } from '../../ui'
import { useAdminDict } from './useAdmin'

const STATUS_TONE: Record<CrashStatus, PillTone> = { new: 'danger', in_progress: 'warning', resolved: 'success' }

export function CrashStatusPill({ status }: { status: CrashStatus }) {
  const p = useAdminDict()
  return <Pill tone={STATUS_TONE[status]}>{p.crashes.statuses[status]}</Pill>
}

/** The symbolicated stack, or raw offsets with a "no symbols" note. Frontend reports show the JS stack. */
export function CrashStack({ report }: { report: CrashReportDetail }) {
  const c = useAdminDict().crash
  const { payload, symbolicated } = report
  const location = payload.location && (
    <p className="t-s">
      <span className="t-muted">{c.location}: </span>
      <code className="adm-mono">{payload.location}</code>
    </p>
  )
  if (payload.js_stack)
    return (
      <>
        <p className="t-s t-muted">{c.jsStack}</p>
        <pre className="adm-pre">{payload.js_stack}</pre>
      </>
    )
  if (!payload.frames.length)
    return (
      <>
        {location}
        <p className="t-muted t-s">{c.noFrames}</p>
      </>
    )
  // A PDB from another build resolves nothing: same note as no PDB at all.
  if (!symbolicated || symbolicated.every((f) => f.symbols.length === 0))
    return (
      <>
        <Note tone="warning">{fmt(c.noSymbols, { version: report.app_version })}</Note>
        {location}
        <ol className="adm-stack">
          {payload.frames.map((f, i) => (
            <li key={i}>
              <code className="adm-mono">
                {f.module}+{f.offset}
              </code>
            </li>
          ))}
        </ol>
      </>
    )
  return (
    <>
      {location}
      <ol className="adm-stack">
        {symbolicated.map((f, i) => (
          <li key={i}>
            {f.symbols.length === 0 ? (
              <code className="adm-mono t-muted">
                {f.module}+{f.offset}
              </code>
            ) : (
              f.symbols.map((s, j) => (
                <span key={j} className="adm-frame" data-inlined={j > 0 || undefined}>
                  <code className="adm-mono adm-frame-fn" data-app={s.in_app || undefined}>
                    {s.function}
                  </code>
                  {s.file && (
                    <span className="adm-sub adm-mono">
                      {s.file}
                      {s.line ? `:${s.line}` : ''}
                    </span>
                  )}
                </span>
              ))
            )}
          </li>
        ))}
      </ol>
    </>
  )
}
