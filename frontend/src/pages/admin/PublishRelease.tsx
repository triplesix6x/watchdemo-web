import { useState, type CSSProperties, type FormEvent } from 'react'
import { uploadForm } from '../../api/client'
import type { AdminRelease } from '../../types'

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/
// Tauri называет сборку так: WatchDemo_0.8.0_x64-setup.exe — версию оттуда
// и достаём, чтобы её не приходилось вбивать руками (и ошибаться).
const VERSION_IN_NAME = /[_-](\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)[_-]/

const inputStyle: CSSProperties = {
  border: '1px solid #d1d5db',
  borderRadius: 5,
  padding: '0.4rem 0.6rem',
  fontSize: '0.85rem',
  width: '100%',
}

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: '0.8rem',
  fontWeight: 600,
  marginBottom: '0.25rem',
}

function fmtSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

interface Props {
  onPublished: () => void
}

/**
 * Заливка новой сборки десктопного клиента.
 *
 * Пара «инсталлятор + .sig» лежит рядом в src-tauri/target/release/bundle/nsis,
 * поэтому форма принимает оба файла одним выбором и сама разбирается, что
 * есть что. Версию тянет из имени файла: она обязана совпадать с версией
 * внутри сборки, иначе сервер пообещает клиентам одно, а инсталлятор
 * поставит другое — и обновление зациклится.
 */
export default function PublishRelease({ onPublished }: Props) {
  const [installer, setInstaller] = useState<File | null>(null)
  const [sigFile, setSigFile] = useState<File | null>(null)
  const [signature, setSignature] = useState('')
  const [version, setVersion] = useState('')
  const [channel, setChannel] = useState<'stable' | 'beta'>('stable')
  const [target, setTarget] = useState('windows')
  const [arch, setArch] = useState('x86_64')
  const [notes, setNotes] = useState('')

  const [busy, setBusy] = useState(false)
  const [percent, setPercent] = useState(0)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  const pickFiles = (files: FileList | null) => {
    if (!files) return
    setError('')
    for (const f of Array.from(files)) {
      if (f.name.toLowerCase().endsWith('.sig')) {
        setSigFile(f)
      } else {
        setInstaller(f)
        const m = VERSION_IN_NAME.exec(f.name)
        if (m) setVersion(m[1])
      }
    }
  }

  const reset = () => {
    setInstaller(null)
    setSigFile(null)
    setSignature('')
    setVersion('')
    setNotes('')
    setPercent(0)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setMsg('')

    if (!installer) return setError('Attach the installer from bundle/nsis')
    if (!sigFile && !signature.trim()) {
      return setError('Attach the .sig file or paste the signature — the client rejects unsigned builds')
    }
    if (!SEMVER.test(version.trim())) {
      return setError(`"${version}" is not a valid semver version`)
    }

    const form = new FormData()
    form.append('installer', installer)
    if (sigFile) form.append('signature_file', sigFile)
    else form.append('signature', signature.trim())
    form.append('version', version.trim())
    form.append('channel', channel)
    form.append('target', target.trim())
    form.append('arch', arch.trim())
    if (notes.trim()) form.append('notes', notes.trim())

    setBusy(true)
    setPercent(0)
    try {
      const release = await uploadForm<AdminRelease>('/admin/releases', form, setPercent)
      setMsg(`Published ${release.version} to ${release.channel}. Clients will pick it up on next launch.`)
      reset()
      onPublished()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <h2>Publish a build</h2>
      <p className="text-sm" style={{ marginBottom: '1rem' }}>
        Select both files from <code>src-tauri/target/release/bundle/nsis</code> —
        the installer and its <code>.sig</code>.
      </p>

      {msg && <div className="alert alert-success">{msg}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <form onSubmit={submit}>
        <div style={{ marginBottom: '1rem' }}>
          <label style={labelStyle} htmlFor="release-files">Installer + signature</label>
          <input
            id="release-files"
            type="file"
            multiple
            accept=".exe,.sig,.zip"
            disabled={busy}
            onChange={e => pickFiles(e.target.files)}
            style={inputStyle}
          />
          <div className="text-sm" style={{ marginTop: '0.35rem' }}>
            {installer
              ? `Installer: ${installer.name} (${fmtSize(installer.size)})`
              : 'Installer: not selected'}
            {' · '}
            {sigFile ? `Signature: ${sigFile.name}` : 'Signature: not selected'}
          </div>
        </div>

        {!sigFile && (
          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle} htmlFor="release-sig">Signature (paste instead of file)</label>
            <textarea
              id="release-sig"
              rows={3}
              value={signature}
              disabled={busy}
              onChange={e => setSignature(e.target.value)}
              style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '0.75rem' }}
            />
          </div>
        )}

        <div className="row" style={{ gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 140px' }}>
            <label style={labelStyle} htmlFor="release-version">Version</label>
            <input
              id="release-version"
              value={version}
              disabled={busy}
              placeholder="0.8.0"
              onChange={e => setVersion(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={{ flex: '0 1 120px' }}>
            <label style={labelStyle} htmlFor="release-channel">Channel</label>
            <select
              id="release-channel"
              value={channel}
              disabled={busy}
              onChange={e => setChannel(e.target.value as 'stable' | 'beta')}
              style={inputStyle}
            >
              <option value="stable">stable</option>
              <option value="beta">beta</option>
            </select>
          </div>
          <div style={{ flex: '0 1 120px' }}>
            <label style={labelStyle} htmlFor="release-target">Target</label>
            <input
              id="release-target"
              value={target}
              disabled={busy}
              onChange={e => setTarget(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={{ flex: '0 1 120px' }}>
            <label style={labelStyle} htmlFor="release-arch">Arch</label>
            <input
              id="release-arch"
              value={arch}
              disabled={busy}
              onChange={e => setArch(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label style={labelStyle} htmlFor="release-notes">Release notes</label>
          <textarea
            id="release-notes"
            rows={4}
            value={notes}
            disabled={busy}
            placeholder="Shown on the update screen inside the app"
            onChange={e => setNotes(e.target.value)}
            style={inputStyle}
          />
        </div>

        {busy && (
          <div style={{ marginBottom: '1rem' }}>
            <div
              style={{
                height: 6,
                borderRadius: 999,
                background: '#e5e7eb',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${percent}%`,
                  background: '#2563eb',
                  transition: 'width 0.2s',
                }}
              />
            </div>
            <div className="text-sm" style={{ marginTop: '0.3rem' }}>
              Uploading… {percent}%
            </div>
          </div>
        )}

        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Uploading…' : 'Publish'}
        </button>
      </form>
    </div>
  )
}
