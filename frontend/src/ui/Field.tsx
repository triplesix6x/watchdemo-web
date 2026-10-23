// Form controls. Every input has a visible label (Field); placeholders are format hints
// only. Field wires id, aria-describedby and aria-invalid into the control inside it.
import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'

type FieldCtx = { id: string; describedBy?: string; invalid: boolean; required?: boolean }
const Ctx = createContext<FieldCtx | null>(null)

export type FieldProps = {
  label: ReactNode
  /** Always-visible help under the control. */
  hint?: ReactNode
  /** Error text; marks the control invalid. Show after blur or submit, clear on edit. */
  error?: ReactNode
  required?: boolean
  /** Text after the label for optional fields, e.g. t.form.optional. */
  optionalText?: string
  className?: string
  children: ReactNode
}

export function Field({ label, hint, error, required, optionalText, className = '', children }: FieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errId = error ? `${id}-err` : undefined
  const describedBy = [errId, hintId].filter(Boolean).join(' ') || undefined
  return (
    <div className={`field ${className}`}>
      <label className="field-label" htmlFor={id}>
        {label}
        {!required && optionalText && <span className="field-req"> {optionalText}</span>}
      </label>
      <Ctx.Provider value={{ id, describedBy, invalid: !!error, required }}>{children}</Ctx.Provider>
      {error && (
        <p className="field-error" id={errId} role="alert">
          {error}
        </p>
      )}
      {hint && (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  )
}

function useFieldProps(className: string, extra?: string) {
  const f = useContext(Ctx)
  return {
    id: f?.id,
    'aria-describedby': f?.describedBy,
    'aria-invalid': f?.invalid || undefined,
    required: f?.required,
    className: ['input', extra, className].filter(Boolean).join(' '),
  }
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className = '', ...rest }, ref) {
  return <input ref={ref} {...useFieldProps(className)} {...rest} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className = '', ...rest }, ref) {
  return <textarea ref={ref} {...useFieldProps(className)} {...rest} />
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className = '', ...rest }, ref) {
  return <select ref={ref} {...useFieldProps(className)} {...rest} />
})

type CheckProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> & {
  label: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
}

/** Native checkbox painted with accent-color; the whole row is the hit area. */
export function Checkbox({ label, checked, onChange, className = '', ...rest }: CheckProps) {
  return (
    <label className={`check ${className}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} {...rest} />
      <span>{label}</span>
    </label>
  )
}

/** On/off that applies at once (settings). For "agree" use Checkbox. */
export function Switch({ label, checked, onChange, disabled, className = '' }: { label: ReactNode; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; className?: string }) {
  const id = useId()
  return (
    <span className={`switch-wrap ${className}`}>
      <button id={id} type="button" role="switch" aria-checked={checked} disabled={disabled} className="switch press" onClick={() => onChange(!checked)} />
      <label htmlFor={id}>{label}</label>
    </span>
  )
}
