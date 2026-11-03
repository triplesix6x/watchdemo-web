import generated from '../../content/legal.generated.json'

export type LegalStatus = 'draft' | 'effective' | 'archived'
export interface LegalDocument {
  id: string
  revision: string
  status: LegalStatus
  language: 'ru'
  title: string
  published_at: string
  effective_at: string | null
  body: string
  sha256: string
  url: string
}
interface LegalCatalog {
  schema_version: 1
  catalog_sha256: string
  release: { sequence: number; effective_at: string | null; legal_review_approved: boolean; evidence_retention_days: number | null }
  documents: LegalDocument[]
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const list = (v: unknown): v is unknown[] => Array.isArray(v)
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const nullableDate = (v: unknown): v is string | null => v === null || date(v)
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)

function readDocument(doc: unknown): LegalDocument {
  if (record(doc) && typeof doc.id === 'string' && typeof doc.revision === 'string' &&
    (doc.status === 'draft' || doc.status === 'effective' || doc.status === 'archived') && doc.language === 'ru' && typeof doc.title === 'string' &&
    typeof doc.body === 'string' && hash(doc.sha256) && typeof doc.url === 'string' && date(doc.published_at) && nullableDate(doc.effective_at)) {
    return { id: doc.id, revision: doc.revision, status: doc.status, language: doc.language, title: doc.title,
      published_at: doc.published_at, effective_at: doc.effective_at, body: doc.body, sha256: doc.sha256, url: doc.url }
  }
  throw new Error('Invalid legal document')
}

// Generated JSON is the shared immutable snapshot. Validate shape, never normalize body bytes.
function readCatalog(value: unknown): LegalCatalog {
  if (record(value) && value.schema_version === 1 && hash(value.catalog_sha256) && list(value.documents)) {
    const r = value.release
    if (record(r) && typeof r.sequence === 'number' && nullableDate(r.effective_at) && typeof r.legal_review_approved === 'boolean' &&
      (r.evidence_retention_days === null || typeof r.evidence_retention_days === 'number')) {
      return { schema_version: 1, catalog_sha256: value.catalog_sha256, release: { sequence: r.sequence, effective_at: r.effective_at,
        legal_review_approved: r.legal_review_approved, evidence_retention_days: r.evidence_retention_days }, documents: value.documents.map(readDocument) }
    }
  }
  throw new Error('Invalid legal catalog')
}
export const legalCatalog = readCatalog(generated)
export const legalIds = [...new Set(legalCatalog.documents.map((d) => d.id))]
export function latestDocument(id: string): LegalDocument | undefined {
  return legalCatalog.documents.filter((d) => d.id === id).sort((a, b) => b.published_at.localeCompare(a.published_at) || b.revision.localeCompare(a.revision))[0]
}
export const legalPaths = [
  { path: '/legal', noindex: legalCatalog.documents.some((d) => d.status === 'draft') },
  ...legalIds.map((id) => ({ path: `/legal/${id}`, noindex: latestDocument(id)?.status === 'draft' })),
  ...legalCatalog.documents.map((d) => ({ path: d.url, noindex: d.status === 'draft' })),
]
