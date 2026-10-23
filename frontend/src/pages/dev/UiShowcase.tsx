// /__ui: every component of src/ui in its states. Dev and mock builds only (routes.tsx).
import { useState, type CSSProperties, type ReactNode } from 'react'
import { Download, MoreHorizontal, Pencil, Trash2, Settings, Inbox, RotateCw, Copy } from 'lucide-react'
import { LangSwitch, useT } from '../../i18n'
import { Head } from '../../head/Head'
import {
  Button,
  ButtonLink,
  Card,
  Checkbox,
  ConfirmModal,
  DelayedReveal,
  Dialog,
  Divider,
  EmptyState,
  Field,
  IconButton,
  InlineRename,
  Input,
  Island,
  Logo,
  LogoLoader,
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MiniLoader,
  Pagination,
  Pill,
  RoleBadge,
  Seg,
  SegNav,
  Select,
  Skeleton,
  Stat,
  Switch,
  Table,
  Tabs,
  tabPanelProps,
  Textarea,
  TierBadge,
  useToast,
} from '../../ui'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card as="section" style={{ padding: '1.25rem 1.5rem' }}>
      <h2 style={{ fontSize: '1rem', marginBottom: '1rem' }}>{title}</h2>
      <div className="stack">{children}</div>
    </Card>
  )
}
const Row = ({ children }: { children: ReactNode }) => (
  <div className="row" style={{ flexWrap: 'wrap', '--row-gap': '0.75rem' } as CSSProperties}>
    {children}
  </div>
)

const SWATCHES = ['--ink-50', '--ink-100', '--ink-200', '--ink-300', '--ink-400', '--ink-500', '--ink-600', '--ink-700', '--ink-800', '--ink-900', '--ink-950', '--brand-300', '--brand-400', '--brand-500', '--brand-600', '--side-t', '--side-ct', '--success', '--warning', '--danger']

function Personas() {
  const [persona, setPersonaState] = useState<string>(() => {
    try {
      return localStorage.getItem('wd-mock-user') ?? 'admin'
    } catch {
      return 'admin'
    }
  })
  if (!__MOCK__) return <p className="t-s t-muted">Mock API is off in this build: run `npm run dev:mock`.</p>
  return (
    <Seg
      label="Mock persona"
      value={persona}
      onChange={async (p) => {
        const m = await import('../../api/mock')
        m.setPersona(p as Parameters<typeof m.setPersona>[0])
        setPersonaState(p)
        location.reload()
      }}
      items={[
        { value: 'admin', label: 'Admin' },
        { value: 'moderator', label: 'Moderator' },
        { value: 'support', label: 'Support' },
        { value: 'pro', label: 'Pro user' },
        { value: 'free', label: 'No plan' },
        { value: 'anon', label: 'Signed out' },
      ]}
    />
  )
}

export default function UiShowcase() {
  const t = useT()
  const toast = useToast()
  const [seg, setSeg] = useState<'all' | 'groups'>('all')
  const [tab, setTab] = useState<'info' | 'replay' | 'moments' | 'notes'>('info')
  const [check, setCheck] = useState(true)
  const [sw, setSw] = useState(false)
  const [dialog, setDialog] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState('falcons-vs-spirit-m1-mirage')
  const [page, setPage] = useState(1)
  const [intro, setIntro] = useState(0)
  const [skeletonKey, setSkeletonKey] = useState(0)

  return (
    <main id="main" tabIndex={-1} className="container" style={{ paddingBlock: '2.5rem 4rem' }}>
      <Head title="UI" noindex />
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div>
          <h1 className="t-h1">UI</h1>
          <p className="t-muted">src/ui · styles in src/styles · dev and mock builds only</p>
        </div>
        <LangSwitch />
      </div>

      <div className="stack" style={{ '--stack-gap': '1.25rem' } as CSSProperties}>
        <Section title="Mock API">
          <Personas />
        </Section>

        <Section title="Brand">
          <Row>
            <span style={{ color: 'var(--brand-400)' }}>
              <Logo key={intro} size={64} intro />
            </span>
            <Button variant="ghost" onClick={() => setIntro((n) => n + 1)}>
              <RotateCw size={14} aria-hidden /> Replay intro
            </Button>
            <LogoLoader size={48} label={t.state.loading} />
            <span style={{ color: 'var(--brand-400)' }}>
              <MiniLoader size={14} />
            </span>
            <MiniLoader size={16} />
          </Row>
        </Section>

        <Section title="Type">
          <p className="t-display">Смотреть в CS2</p>
          <p className="t-h1">Заголовок страницы h1</p>
          <p className="t-h2">Раздел h2</p>
          <p className="t-h3">Подраздел h3</p>
          <p className="t-lead measure">Лид: одна-две фразы о том, что на странице. Onest, 400, межстрочный 1.5.</p>
          <p className="measure">
            Основной текст 16-17 px с интерлиньяжем 1.55. Ссылка внутри текста <a className="link" href="#type">подчёркнута в покое</a>. Время <span className="num">01:10</span>, версия <span className="num">0.7.6</span>.
          </p>
          <p className="t-s t-muted">Мелкий приглушённый текст ink-300.</p>
        </Section>

        <Section title="Palette">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: '0.5rem' }}>
            {SWATCHES.map((v) => (
              <div key={v} className="t-xs t-muted">
                <div style={{ height: 40, borderRadius: 'var(--r-lg)', background: `var(${v})`, border: '1px solid var(--c-line)' }} />
                {v}
              </div>
            ))}
          </div>
        </Section>

        <Section title="Buttons">
          <Row>
            <Button variant="primary">Скачать для Windows</Button>
            <Button variant="soft">Открыть</Button>
            <Button variant="ghost">Отмена</Button>
            <Button variant="danger">Удалить аккаунт</Button>
          </Row>
          <Row>
            <Button variant="primary" size="lg">
              <Download size={18} aria-hidden /> Скачать для Windows
            </Button>
            <Button variant="soft" size="lg">
              Тарифы
            </Button>
            <Button variant="primary" loading>
              Сохраняем
            </Button>
            <Button variant="soft" disabled>
              Недоступно
            </Button>
          </Row>
          <Row>
            <IconButton label="Настройки" icon={<Settings size={16} />} />
            <IconButton small label="Изменить" icon={<Pencil size={14} />} />
            <ButtonLink to="/pricing" variant="soft">
              Ссылка-кнопка
            </ButtonLink>
            <ButtonLink href="https://t.me/watchdemopro" variant="ghost">
              Telegram
            </ButtonLink>
          </Row>
        </Section>

        <Section title="Surfaces">
          <div className="app-frame" style={{ padding: '0.75rem', borderRadius: 'var(--r-2xl)', display: 'flex', gap: '0.375rem' }}>
            <Island style={{ width: 200, padding: '0.75rem 0' }}>
              <p className="t-xs t-muted" style={{ padding: '0 1rem 0.5rem' }}>
                Island
              </p>
              <button className="list-row list-row-hover" style={{ width: 'calc(100% - 0.75rem)' }}>
                list-row
              </button>
              <button className="list-row list-row-active" style={{ width: 'calc(100% - 0.75rem)' }}>
                list-row-active
              </button>
            </Island>
            <Island style={{ flex: 1, padding: '1rem' }}>
              <Card style={{ padding: '1rem' }}>Card</Card>
              <Divider className="" />
              <Card raised style={{ padding: '1rem', marginTop: '0.75rem' }}>
                Card raised
              </Card>
            </Island>
          </div>
        </Section>

        <Section title="Seg, Tabs, SegNav">
          <Row>
            <Seg label="Список" value={seg} onChange={setSeg} items={[{ value: 'all', label: 'Все', count: 3 }, { value: 'groups', label: 'Группы', count: 2 }]} />
            <SegNav
              label="Админка"
              items={[
                { to: '/__ui', label: 'Текущая', end: true },
                { to: '/admin/users', label: 'Пользователи' },
                { to: '/admin/releases', label: 'Релизы' },
              ]}
            />
          </Row>
          <Tabs
            idBase="demo"
            label="Демка"
            value={tab}
            onChange={setTab}
            items={[
              { value: 'info', label: 'Инфо' },
              { value: 'replay', label: '2D реплей' },
              { value: 'moments', label: 'Моменты' },
              { value: 'notes', label: 'Заметки' },
            ]}
          />
          <div {...tabPanelProps('demo', tab)} className="t-s t-muted">
            Панель вкладки «{tab}». Стрелки и Home/End переключают вкладки.
          </div>
        </Section>

        <Section title="Fields">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
            <Field label="Почта" hint="На неё придёт ссылка для входа." required>
              <Input type="email" autoComplete="email" placeholder="name@example.com" />
            </Field>
            <Field label="Пароль" error={t.authErrors.passwordLength} required>
              <Input type="password" defaultValue="short" />
            </Field>
            <Field label="Канал" optionalText={t.form.optional}>
              <Select defaultValue="stable">
                <option value="stable">stable</option>
                <option value="beta">beta</option>
              </Select>
            </Field>
            <Field label="Заметки к релизу" optionalText={t.form.optional}>
              <Textarea rows={3} defaultValue="- Плейлисты моментов" />
            </Field>
          </div>
          <Row>
            <Checkbox label="Выйти на других устройствах" checked={check} onChange={setCheck} />
            <Switch label="Показывать в «Что нового»" checked={sw} onChange={setSw} />
          </Row>
        </Section>

        <Section title="Menu, Dialog, ConfirmModal, Toast">
          <Row>
            <Menu
              label="Действия с демкой"
              trigger={(p) => (
                <button type="button" className="btn btn-icon" aria-label="Действия" title="Действия" {...p}>
                  <MoreHorizontal size={16} />
                </button>
              )}
            >
              <MenuLabel>falcons-vs-spirit</MenuLabel>
              <MenuItem icon={<Pencil size={15} />} onSelect={() => setRenaming(true)}>
                {t.actions.rename}
              </MenuItem>
              <MenuItem icon={<Copy size={15} />} onSelect={() => toast(t.actions.copied, { tone: 'success' })}>
                {t.actions.copy}
              </MenuItem>
              <MenuItem to="/help">Помощь</MenuItem>
              <MenuSeparator />
              <MenuItem danger icon={<Trash2 size={15} />} onSelect={() => setConfirm(true)}>
                {t.actions.delete}
              </MenuItem>
            </Menu>
            <Button onClick={() => setDialog(true)}>Открыть диалог</Button>
            <Button variant="danger" onClick={() => setConfirm(true)}>
              Удалить аккаунт
            </Button>
            <Button variant="ghost" onClick={() => toast('Профиль сохранён', { tone: 'success' })}>
              Тост
            </Button>
            <Button variant="ghost" onClick={() => toast(t.errors.network, { tone: 'error' })}>
              Тост с ошибкой
            </Button>
          </Row>
          <Dialog
            open={dialog}
            onClose={() => setDialog(false)}
            title="Сменить почту"
            footer={
              <>
                <Button variant="soft" onClick={() => setDialog(false)}>
                  {t.actions.cancel}
                </Button>
                <Button variant="primary" onClick={() => setDialog(false)}>
                  Отправить ссылку
                </Button>
              </>
            }
          >
            <div className="stack">
              <p>Ссылка для подтверждения придёт на новый адрес.</p>
              <Field label="Новая почта">
                <Input type="email" data-autofocus />
              </Field>
            </div>
          </Dialog>
          <ConfirmModal
            open={confirm}
            variant="danger"
            title="Удалить аккаунт?"
            message={'Почта и имя будут обезличены, все сессии завершатся.\nОтменить это нельзя.'}
            confirmLabel="Удалить аккаунт"
            busy={busy}
            onCancel={() => setConfirm(false)}
            onConfirm={() => {
              setBusy(true)
              setTimeout(() => {
                setBusy(false)
                setConfirm(false)
                toast('Аккаунт удалён', { tone: 'success' })
              }, 900)
            }}
          />
        </Section>

        <Section title="InlineRename">
          <div className="card" style={{ padding: '0.5rem', maxWidth: 360 }}>
            {renaming ? (
              <InlineRename value={name} label="Новое имя демки" onCommit={setName} onDone={() => setRenaming(false)} />
            ) : (
              <button className="list-row list-row-hover" style={{ width: 'calc(100% - 0.75rem)' }} onDoubleClick={() => setRenaming(true)} onKeyDown={(e) => e.key === 'F2' && setRenaming(true)}>
                {name}
              </button>
            )}
          </div>
          <p className="t-xs t-muted">Двойной клик или F2. Enter сохраняет, Esc отменяет.</p>
        </Section>

        <Section title="Pills and badges">
          <Row>
            <Pill>neutral</Pill>
            <Pill tone="brand">brand</Pill>
            <Pill tone="success">разобрана</Pill>
            <Pill tone="warning">beta</Pill>
            <Pill tone="danger">отключён</Pill>
            <Pill tone="t">T</Pill>
            <Pill tone="ct">CT</Pill>
          </Row>
          <Row>
            <TierBadge subscription={null} />
            <TierBadge subscription={{ tier: 'basic', effective_tier: 'basic', expires_at: null, is_expired: false }} />
            <TierBadge subscription={{ tier: 'plus', effective_tier: 'plus', expires_at: null, is_expired: false }} />
            <TierBadge subscription={{ tier: 'pro', effective_tier: 'pro', expires_at: null, is_expired: false }} />
            <TierBadge subscription={{ tier: 'pro', effective_tier: 'basic', expires_at: null, is_expired: true }} />
            <RoleBadge role="user" />
            <RoleBadge role="support" />
            <RoleBadge role="moderator" />
            <RoleBadge role="admin" />
          </Row>
        </Section>

        <Section title="Stat, Table, Pagination">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
            <Stat label="Пользователи" value="41" hint="+6 за 7 дней" tone="up" />
            <Stat label="Платящие" value="12" hint="Plus и Pro" />
            <Stat label="Истекают за 7 дней" value="3" hint="-1 к прошлой неделе" tone="down" />
          </div>
          <Table label="Пользователи">
            <thead>
              <tr>
                <th>Имя</th>
                <th>Тариф</th>
                <th>Роль</th>
                <th className="num">Демок</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['zeroikins', 'pro', 'admin', 214],
                ['player', 'plus', 'user', 37],
                ['newbie', null, 'user', 0],
              ].map(([n, tier, role, demos]) => (
                <tr key={n as string}>
                  <td>{n}</td>
                  <td>
                    <TierBadge subscription={tier ? { tier: tier as 'pro', effective_tier: tier as 'pro', expires_at: null, is_expired: false } : null} />
                  </td>
                  <td>
                    <RoleBadge role={role as 'user'} />
                  </td>
                  <td className="num">{demos}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} pageSize={25} total={41} onPage={setPage} />
        </Section>

        <Section title="Skeleton, DelayedReveal, EmptyState">
          <Row>
            <Button variant="ghost" onClick={() => setSkeletonKey((k) => k + 1)}>
              <RotateCw size={14} aria-hidden /> Replay delayed reveal (300 ms)
            </Button>
          </Row>
          <DelayedReveal key={skeletonKey} delay={300}>
            <div className="stack" style={{ '--stack-gap': '0.5rem', maxWidth: 420 } as CSSProperties}>
              <Skeleton height="1.25rem" width="60%" />
              <Skeleton height="0.875rem" />
              <Skeleton height="0.875rem" width="80%" />
            </div>
          </DelayedReveal>
          <EmptyState
            className="card"
            icon={<Inbox size={18} />}
            title="Релизов пока нет"
            text="Опубликуйте первую сборку, и она появится на странице загрузки."
            action={<Button variant="primary">Опубликовать</Button>}
          />
        </Section>
      </div>
    </main>
  )
}
