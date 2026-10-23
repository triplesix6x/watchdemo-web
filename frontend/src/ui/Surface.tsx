import type { ElementType, HTMLAttributes, ReactNode } from 'react'

type SurfaceProps = HTMLAttributes<HTMLElement> & { as?: ElementType; children?: ReactNode }

/** Work area on the app frame: rounded, top highlight, soft shadow (cabinet and admin). */
export function Island({ as: Tag = 'section', className = '', ...rest }: SurfaceProps) {
  return <Tag className={`island ${className}`} {...rest} />
}

/** A list or a section inside an island or a page. `raised` is the popover layer. */
export function Card({ as: Tag = 'div', raised, className = '', ...rest }: SurfaceProps & { raised?: boolean }) {
  return <Tag className={`${raised ? 'card-raised' : 'card'} ${className}`} {...rest} />
}

/** Hairline that fades out at both ends. */
export const Divider = ({ soft, className = '' }: { soft?: boolean; className?: string }) => (
  <hr className={`${soft ? 'divider-soft' : 'divider'} ${className}`} />
)
