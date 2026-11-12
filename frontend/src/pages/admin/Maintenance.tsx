import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError } from '../../api/errors'
import { useAuth } from '../../context/AuthContext'
import { maintenanceApi } from '../../features/maintenance/api'
import { normalizeText, textLength, validateSettings, type MaintenanceSettings, type NoticeField, type NoticeProblem } from '../../features/maintenance/contract'
import { maintenanceCopy } from '../../features/maintenance/copy'
import { useLocale } from '../../i18n'
import { useAsync } from '../../lib/useAsync'
import { Button, Checkbox, Field, LoadError, Note, PageHead, Pending, Section, Skeleton, Textarea } from '../../ui'
import '../../features/maintenance/maintenance.css'

function NoticeForm({ initial }: { initial: MaintenanceSettings }) {
  const p = maintenanceCopy[useLocale()]
  const [values, setValues] = useState(initial)
  const [errors, setErrors] = useState<Partial<Record<NoticeField, NoticeProblem>>>({})
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [failure, setFailure] = useState<'forbidden' | 'saveError' | null>(null)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  const ruRef = useRef<HTMLTextAreaElement>(null)
  const enRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const clearField = (field: NoticeField) => setErrors((current) => ({ ...current, [field]: undefined }))
  const changeText = (field: NoticeField, value: string) => {
    setValues((current) => ({ ...current, [field]: value }))
    clearField(field)
    setSaved(false)
    setFailure(null)
  }
  const blur = (field: NoticeField) => {
    setErrors((current) => ({ ...current, [field]: validateSettings(values)[field] }))
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (inFlight.current) return
    const problems = validateSettings(values)
    setErrors(problems)
    setSaved(false)
    setFailure(null)
    if (Object.keys(problems).length) {
      if (problems.text_ru) ruRef.current?.focus()
      else enRef.current?.focus()
      return
    }
    inFlight.current = true
    setBusy(true)
    try {
      const next = await maintenanceApi.save({ ...values, text_ru: normalizeText(values.text_ru), text_en: normalizeText(values.text_en) })
      if (mounted.current) { setValues(next); setSaved(true) }
    } catch (error: unknown) {
      if (mounted.current) setFailure(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'saveError')
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy(false)
    }
  }

  return <form onSubmit={(event) => { void submit(event) }} noValidate className="maintenance-form" aria-busy={busy}>
    <Section title={p.section}>
      <fieldset disabled={busy} className="maintenance-fields">
        <Checkbox label={p.enabled} checked={values.enabled} onChange={(enabled) => {
          setValues((current) => ({ ...current, enabled }))
          clearField('text_ru'); setSaved(false); setFailure(null)
        }} />
        <Field label={p.ru} required={values.enabled} hint={`${p.hint} ${textLength(values.text_ru)}/500`} error={errors.text_ru && p.errors[errors.text_ru]}>
          <Textarea ref={ruRef} name="text_ru" lang="ru" rows={4} value={values.text_ru}
            onChange={(event) => changeText('text_ru', event.target.value)} onBlur={() => blur('text_ru')} />
        </Field>
        <Field label={p.en} hint={`${p.fallback} ${p.hint} ${textLength(values.text_en)}/500`} error={errors.text_en && p.errors[errors.text_en]}>
          <Textarea ref={enRef} name="text_en" lang="en" rows={4} value={values.text_en}
            onChange={(event) => changeText('text_en', event.target.value)} onBlur={() => blur('text_en')} />
        </Field>
      </fieldset>
      {failure && <Note tone="danger">{p[failure]}</Note>}
      {saved && <Note tone="success">{p.saved}</Note>}
      <div className="maintenance-actions"><Button type="submit" variant="primary" loading={busy}>{p.save}</Button></div>
    </Section>
  </form>
}

function Editor() {
  const p = maintenanceCopy[useLocale()]
  const notice = useAsync(maintenanceApi.settings, [])
  if (notice.loading) return <Pending label={p.loading}><Skeleton height="18rem" /></Pending>
  if (notice.error || !notice.data) return <LoadError text={notice.error?.status === 403 ? p.forbidden : p.loadError} onRetry={notice.reload} />
  return <NoticeForm initial={notice.data} />
}

export default function AdminMaintenance() {
  const p = maintenanceCopy[useLocale()]
  const { user } = useAuth()
  return <>
    <PageHead title={p.title} lead={p.lead} />
    {user?.role === 'admin' ? <Editor /> : <Note tone="danger">{p.forbidden}</Note>}
  </>
}
