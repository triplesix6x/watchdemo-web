import type ru from './pricing.ru'
const en: typeof ru = {
  meta: { title: 'Pricing', description: 'Free, Plus and Pro limits and features. Sales are not open; request free test access through support.' },
  h1: 'Pricing',
  lead: 'Sales are not open yet. Free: ₽0, Plus: ₽349/month, Pro: ₽469/month. Request free test access through support.',
  tableLabel: 'Free, Plus and Pro compared', feature: 'Feature', recommended: 'Recommended',
  hints: {
    demo_import: 'Free: 5 per calendar month. Plus: 15 per month from activation. Pro: unlimited.',
    content_search: 'Library search and auto moments on every plan. Playbooks are separate, Pro only.',
    replay2d: 'On every plan. Voice is available on Plus and Pro.', advanced_stats: 'On every plan.',
    demo_groups: 'Number of library groups.', custom_sets: 'Number of custom sets for each demo.',
    voice: 'Plus and Pro.', notes: 'Plus and Pro.', playbooks: 'Pro only, unlimited.',
  },
  unlimited: 'Unlimited', yes: 'Included', no: 'Not included', price: 'Price, sales closed', free: '₽0 · Free',
  perMonth: '{price} a month', getPro: 'Free test access', downloadFree: 'Free test access',
  calendarMonth: 'per calendar month', activationMonth: 'per month from activation',
  loading: 'Loading plans', error: { title: 'Could not load the plans' }, faqTitle: 'How access works',
  faq: [
    { q: 'How do I get access?', a: 'Sales are not open yet. Request a free test in the support chat on the Help page after signing in, or on Telegram as a guest. Existing administrator plan grants remain available.' },
    { q: 'When does the plan appear in the app?', a: 'The app fetches the assigned plan on launch and when you open the account window. Enforcement of the new quotas in Windows needs a separate check; a row in the API table does not confirm enforcement in your installed version.' },
    { q: 'What does Free include?', a: '5 imports per calendar month, 2 groups and 1 custom set per demo. Search, auto moments, 2D replay, advanced stats and CS2 viewing are on every plan. Plus: 15 imports per month from activation, 5 groups, 2 sets, voice and notes. Pro: unlimited for these quotas, plus playbooks.' },
    { q: 'Do quotas require uploading demos?', a: 'No. Server quota accounting does not mean uploading demos or their contents. Do not send demos, voice recordings, passwords, payment secrets or third-party data to support.' },
  ],
}
export default en
