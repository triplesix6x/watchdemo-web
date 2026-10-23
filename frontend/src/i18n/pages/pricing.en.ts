import type ru from './pricing.ru'

const en: typeof ru = {
  meta: {
    title: 'Pricing',
    description: 'Compare Basic, Plus and Pro: demo imports, search, the 2D replay and advanced stats.',
  },
  h1: 'Pricing',
  lead: 'Basic is free and enough to try the app. Plus adds the 2D replay and more imports, Pro removes the limit.',
  tableLabel: 'Basic, Plus and Pro compared',
  feature: 'Feature',
  recommended: 'Recommended',
  // Feature names are shared (t.feature); this is the line under each name.
  hints: {
    demo_import: 'Per month. The counter resets at the start of each calendar month.',
    content_search: 'Kills, clutches, grenades and map zones across your library, auto moments and the playbook.',
    replay2d: 'A round radar with voice chat, the player panel and drawing tools.',
    advanced_stats: '',
  },
  unlimited: 'Unlimited',
  yes: 'Included',
  no: 'Not included',
  price: 'Price',
  free: 'Free',
  pricePending: 'Price to be announced',
  perMonth: '{price} a month',
  getPro: 'Get Pro',
  downloadFree: 'Download for free',
  loading: 'Loading plans',
  error: {
    title: 'Could not load the plans',
  },
  faqTitle: 'How access works',
  faq: [
    {
      q: 'How do I get Plus or Pro?',
      a: 'Message the author on Telegram with your site account name. There is no payment on the site yet, plans are assigned by hand.',
    },
    {
      q: 'When does the plan show up in the app?',
      a: 'The app checks your plan on launch and when you open the account window. Restart WatchDemo or open your account and the new features switch on.',
    },
    {
      q: 'What does Basic include?',
      a: 'Everything ticked in the Basic column: up to 10 demo imports a month, library search, auto moments and one-click viewing in CS2. All you need is a site account.',
    },
    {
      q: 'What happens when I run out of imports?',
      a: 'Demos you already imported stay in the library and keep working. You can add new ones next month or after moving to a higher plan.',
    },
  ],
}
export default en
