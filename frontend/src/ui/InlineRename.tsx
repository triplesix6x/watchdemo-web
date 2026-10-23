import { useEffect, useRef } from 'react'

// Rename in place. Enter saves, Esc cancels, blur saves; an empty or unchanged name is a
// quiet cancel. Enter is followed by a blur, so finishing runs once.
// onDone(byKey): true when finished from the keyboard, so the parent may return focus to
// the row. After a blur, focus is already where the user clicked; do not take it back.
export function InlineRename({
  value,
  label,
  onCommit,
  onDone,
  className = 'input input-sm rename',
}: {
  value: string
  /** Accessible name, e.g. "Новое имя набора". */
  label: string
  onCommit: (name: string) => void
  onDone: (byKey: boolean) => void
  className?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const finish = (save: boolean, byKey: boolean) => {
    if (done.current) return
    done.current = true
    const name = ref.current?.value.trim() ?? ''
    if (save && name && name !== value) onCommit(name)
    onDone(byKey)
  }

  return (
    <input
      ref={ref}
      className={className}
      aria-label={label}
      defaultValue={value}
      onBlur={() => finish(true, false)}
      onKeyDown={(e) => {
        // The row under the field handles Enter, F2 and Esc itself: keep them here.
        e.stopPropagation()
        if (e.key === 'Enter') finish(true, true)
        else if (e.key === 'Escape') {
          e.preventDefault()
          finish(false, true)
        }
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  )
}
