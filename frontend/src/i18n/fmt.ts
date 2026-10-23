/** Fill `{name}` placeholders: fmt(t.footer.version, { version: '0.7.6' }). */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}
