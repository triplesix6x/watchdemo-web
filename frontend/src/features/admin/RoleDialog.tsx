import { useState } from 'react'
import { ROLES, type AdminUserDetail, type Role } from '../../api/types'
import { fmt, useT } from '../../i18n'
import { Button, Dialog, Field, Select } from '../../ui'
import { useAdminDict } from './useAdmin'

export function RoleDialog({ u, busy, onClose, onSave }: { u: AdminUserDetail; busy: boolean; onClose: () => void; onSave: (r: Role) => void }) {
  const p = useAdminDict()
  const t = useT()
  const [role, setRole] = useState<Role>(u.role)
  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      title={fmt(p.user.roleTitle, { name: u.username })}
      size="sm"
      onEnter={() => role !== u.role && onSave(role)}
      footer={
        <>
          <Button variant="soft" onClick={onClose} disabled={busy}>
            {t.actions.cancel}
          </Button>
          <Button variant="primary" loading={busy} disabled={role === u.role} onClick={() => onSave(role)}>
            {p.user.roleSave}
          </Button>
        </>
      }
    >
      <Field label={p.user.roleField} hint={p.user.roleHint}>
        <Select data-autofocus value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {t.role[r]}
            </option>
          ))}
        </Select>
      </Field>
    </Dialog>
  )
}
