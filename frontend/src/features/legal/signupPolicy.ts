import { ApiError } from '../../api/errors.ts'
import type { LegalDocument } from './catalog'

export type RequiredTerms = { document_id: 'terms'; revision: string; sha256: string; url: string }
export type SignupPolicy =
  | { mode: 'draft'; policy_id: null; catalog_sha256: string; required_terms: null; privacy_url: string }
  | { mode: 'enforced'; policy_id: string; catalog_sha256: string; required_terms: RequiredTerms; privacy_url: string }
export type LegalAcceptance = { policy_id: string; terms_revision: string; terms_sha256: string; accepted: true }

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const legalUrl = (v: unknown): v is string => typeof v === 'string' && /^\/(?:en\/)?legal\/[a-z]+(?:\/[a-zA-Z0-9._-]+)?$/.test(v)

/** Reject unknown policy modes and unsafe URLs; failure must never turn into draft signup. */
export function parseSignupPolicy(v: unknown): SignupPolicy {
  if (record(v) && hash(v.catalog_sha256) && legalUrl(v.privacy_url)) {
    const shared = { catalog_sha256: v.catalog_sha256, privacy_url: v.privacy_url }
    if (v.mode === 'draft' && v.policy_id === null && v.required_terms === null) return { ...shared, mode: 'draft', policy_id: null, required_terms: null }
    const r = v.required_terms
    if (v.mode === 'enforced' && typeof v.policy_id === 'string' && v.policy_id.length > 0 && record(r) && r.document_id === 'terms' &&
      typeof r.revision === 'string' && r.revision.length > 0 && hash(r.sha256) && legalUrl(r.url)) {
      return { ...shared, mode: 'enforced', policy_id: v.policy_id, required_terms: { document_id: 'terms', revision: r.revision, sha256: r.sha256, url: r.url } }
    }
  }
  throw new ApiError({ status: 0, message: 'Invalid signup policy' })
}

/** Acceptance can refer only to the exact effective text this bundle can display. */
export function displayedTerms(policy: SignupPolicy, documents: readonly LegalDocument[]): LegalDocument | undefined {
  if (policy.mode !== 'enforced') return undefined
  const required = policy.required_terms
  return documents.find((d) => d.id === required.document_id && d.revision === required.revision && d.sha256 === required.sha256 && d.status === 'effective' && d.url === required.url.replace(/^\/en\//, '/'))
}
export function legalAcceptance(policy: SignupPolicy, checked: boolean, documents: readonly LegalDocument[]): LegalAcceptance | undefined {
  if (policy.mode !== 'enforced' || !checked || !displayedTerms(policy, documents)) return undefined
  return { policy_id: policy.policy_id, terms_revision: policy.required_terms.revision, terms_sha256: policy.required_terms.sha256, accepted: true }
}
