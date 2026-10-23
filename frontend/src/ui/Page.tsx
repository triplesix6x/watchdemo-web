// The head of a cabinet or admin page and its titled section cards.
import { useId, type ReactNode } from 'react'
import { Head } from '../head/Head'

/** h1 with an optional lead and an action on the right. Sets the page title (noindex). */
export function PageHead({ title, lead, aside, className = '' }: { title: ReactNode; lead?: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <>
      <Head title={typeof title === 'string' ? title : undefined} noindex />
      <div className={`shell-page-head ${className}`}>
        <div>
          <h1>{title}</h1>
          {lead && <p>{lead}</p>}
        </div>
        {aside}
      </div>
    </>
  )
}

/** A card with an h2 head; `aside` sits right of the title (a badge, a control, a secondary action). */
export function Section({ title, lead, aside, className = '', children }: { title: ReactNode; lead?: ReactNode; aside?: ReactNode; className?: string; children: ReactNode }) {
  const id = useId()
  return (
    <section className={`card section ${className}`} aria-labelledby={id}>
      <header className="section-head">
        <div>
          <h2 id={id}>{title}</h2>
          {lead && <p className="section-lead">{lead}</p>}
        </div>
        {aside}
      </header>
      {children}
    </section>
  )
}
