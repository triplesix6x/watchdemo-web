// Upload a desktop build. The version comes from the file name: it must match the version
// inside the build, or the updater promises one version, installs another and loops.
import { useId, useState } from 'react'
import { adminApi } from '../../api/endpoints'
import type { AdminRelease, Channel } from '../../api/types'
import { fmt, useLocale, useT } from '../../i18n'
import { formatBytes } from '../../lib/format'
import { useForm } from '../../lib/useForm'
import { Button, Dialog, Field, Input, Note, Seg, Select, Textarea, useToast } from '../../ui'
import { ARCHS, SEMVER, TARGETS, sortPicked } from './release'
import { useAdminDict } from './useAdmin'

export function PublishDialog({ onClose, onPublished }: { onClose: () => void; onPublished: (r: AdminRelease) => void }) {
  const p = useAdminDict()
  const t = useT()
  const locale = useLocale()
  const toast = useToast()
  const formId = useId()
  const [installer, setInstaller] = useState<File | null>(null)
  const [sigFile, setSigFile] = useState<File | null>(null)
  const [channel, setChannel] = useState<Channel>('stable')
  const [percent, setPercent] = useState(0)
  // `installer` holds the picked file's name so the form can validate and focus it.
  const form = useForm(
    { installer: '', signature: '', version: '', target: 'windows', arch: 'x86_64', notes: '' },
    {
      installer: (v) => (v ? null : p.publish.errInstaller),
      signature: (v) => (sigFile || v.trim() ? null : p.publish.errSignature),
      version: (v) => (SEMVER.test(v.trim()) ? null : p.publish.errVersion),
    },
  )
  const busy = form.submitting

  const pick = (files: FileList | null) => {
    const got = sortPicked(Array.from(files ?? []))
    if (got.signature) setSigFile(got.signature)
    if (got.installer) setInstaller(got.installer)
    if (got.beta) setChannel('beta')
    form.set((v) => ({ ...v, installer: got.installer?.name ?? v.installer, version: got.version ?? v.version }))
    form.setErrors((e) => ({
      ...e,
      installer: got.installer ? undefined : e.installer,
      signature: got.signature ? undefined : e.signature,
      version: got.version ? undefined : e.version,
    }))
  }

  const submit = form.onSubmit(async (v) => {
    setPercent(0)
    const r = await adminApi.publishRelease(
      {
        installer: installer!,
        version: v.version.trim(),
        channel,
        target: v.target,
        arch: v.arch,
        notes: v.notes.trim() || undefined,
        ...(sigFile ? { signature_file: sigFile } : { signature: v.signature.trim() }),
      },
      setPercent,
    )
    toast(fmt(p.publish.done, { version: r.version, channel: r.channel }), { tone: 'success' })
    onPublished(r)
  })

  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      title={p.publish.title}
      size="lg"
      footer={
        <>
          <Button variant="soft" onClick={onClose} disabled={busy}>
            {t.actions.cancel}
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={busy}>
            {busy ? fmt(p.publish.uploading, { pct: percent }) : p.publish.submit}
          </Button>
        </>
      }
    >
      <form id={formId} className="adm-publish" onSubmit={submit} noValidate>
        <Field label={p.publish.files} hint={p.publish.filesHint} error={form.errors.installer}>
          <Input name="installer" type="file" multiple accept=".exe,.sig,.zip" disabled={busy} data-autofocus className="adm-file" onChange={(e) => pick(e.target.files)} />
        </Field>
        <dl className="adm-picked">
          <div>
            <dt>{p.publish.installer}</dt>
            <dd className="num">{installer ? `${installer.name} · ${formatBytes(installer.size, locale)}` : p.publish.notPicked}</dd>
          </div>
          <div>
            <dt>{p.publish.signatureFile}</dt>
            <dd className="num">{sigFile ? sigFile.name : p.publish.notPicked}</dd>
          </div>
        </dl>

        {!sigFile && (
          <Field label={p.publish.signature} hint={p.publish.signatureHint} error={form.errors.signature}>
            <Textarea rows={2} className="adm-mono" disabled={busy} {...form.field('signature')} />
          </Field>
        )}

        <div className="adm-publish-row">
          <Field label={p.publish.version} hint={p.publish.versionHint} error={form.errors.version}>
            <Input disabled={busy} className="num" spellCheck={false} {...form.field('version')} />
          </Field>
          <div className="field">
            <span className="field-label" aria-hidden="true">
              {p.publish.channel}
            </span>
            <Seg
              label={p.publish.channel}
              value={channel}
              onChange={setChannel}
              items={[
                { value: 'stable', label: p.releases.stable, disabled: busy },
                { value: 'beta', label: p.releases.beta, disabled: busy },
              ]}
            />
          </div>
          <Field label={p.publish.target}>
            <Select disabled={busy} {...form.field('target')}>
              {TARGETS.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </Select>
          </Field>
          <Field label={p.publish.arch}>
            <Select disabled={busy} {...form.field('arch')}>
              {ARCHS.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label={p.publish.notes} hint={p.publish.notesHint} optionalText={t.form.optional}>
          <Textarea rows={4} disabled={busy} {...form.field('notes')} />
        </Field>

        {busy && (
          <div className="adm-progress" role="progressbar" aria-label={p.publish.progress} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <span style={{ width: `${percent}%` }} />
          </div>
        )}
        {form.failure && <Note tone="danger">{form.failure}</Note>}
      </form>
    </Dialog>
  )
}
