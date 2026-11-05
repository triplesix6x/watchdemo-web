import type ru from './pricing.ru'
const en: typeof ru = {
  meta: { title: 'Pricing', description: 'Free, Plus and Pro limits and features. Sales are not open; request free test access through support.' },
  h1: 'Pricing',
  lead: 'Sales are not open yet. Free: ₽0, Plus: ₽349/month, Pro: ₽469/month. Request free test access through support.',
  tableLabel: 'Free, Plus and Pro compared', feature: 'Feature', recommended: 'Recommended',
  hints: {
    demo_import: 'Account-wide: Free — 5 per UTC calendar month, Plus — 15 per month from original paid activation, Pro — unlimited.',
    content_search: 'Library search and auto moments on every plan. Playbooks are separate, Pro only.',
    replay2d: 'On every plan. Voice is available on Plus and Pro.', advanced_stats: 'On every plan.',
    demo_groups: 'Simultaneously across all account libraries: 2 / 5 / unlimited.', custom_sets: 'Monthly account-wide creations: 1 / 2 / unlimited. Not per demo or a cap on stored sets.',
    voice: 'Plus and Pro.', notes: 'Plus and Pro.', playbooks: 'Pro only, unlimited.',
  },
  unlimited: 'Unlimited', yes: 'Included', no: 'Not included', price: 'Price, sales closed', free: '₽0 · Free',
  perMonth: '{price} a month', getPro: 'Free test access', downloadFree: 'Free test access',
  calendarMonth: 'per calendar month', activationMonth: 'per month from activation',
  loading: 'Loading plans', error: { title: 'Could not load the plans' }, faqTitle: 'How access works',
  faq: [
    { q: 'How do I get access?', a: 'Sales are not open yet. Request a free test in the support chat on the Help page after signing in, or on Telegram as a guest. Existing administrator plan grants remain available.' },
    { q: 'When does the plan appear in the app?', a: 'The app fetches the assigned plan on launch and when you open the account window. Enforcement of the new quotas in Windows needs a separate check; a row in the API table does not confirm enforcement in your installed version.' },
    { q: 'What does Free include?', a: 'Across all account libraries: 5 imports and 1 custom set creation per UTC calendar month, with 2 groups simultaneously. Plus: 15 imports and 2 set creations per month from original paid activation, 5 groups simultaneously, voice and notes. Pro: unlimited for these quotas, plus playbooks. Shared sets and saved copies of auto sets count toward the monthly creation quota. Deleting does not refund quota; existing sets do not consume next month’s quota. Search, auto moments, 2D replay, advanced stats and CS2 viewing are on every plan.' },
    { q: 'What happens to existing data and offline?', a: 'Existing demos, groups and sets are not deleted. New imports, set creations and groups require sign-in and online server approval; a connection error does not fall back to a local limit. Support can reset group accounting for the whole account, but this does not replenish import or set-creation quotas. Old libraries re-register their groups during online reconciliation, even above the limit.' },
    { q: 'Do quotas require uploading demos?', a: 'No. Server quota accounting does not mean uploading demos or their contents. Do not send demos, voice recordings, passwords, payment secrets or third-party data to support.' },
  ],
}
export default en
