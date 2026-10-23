import type ru from './changelog.ru'

const en: typeof ru = {
  meta: {
    title: 'What’s new',
    description: 'WatchDemo release history: what was added and fixed in each version.',
  },
  h1: 'What’s new',
  lead: 'Changes in every version of the app, newest first. Releases and beta builds are announced in the Telegram channel.',
  channel: 'Follow the channel',
  latest: 'Latest version',
  timeline: 'Versions on a timeline',
  beta: 'Beta',
  download: 'Download {version}',
  noNotes: 'This version has no notes.',
  loading: 'Loading the release history',
  empty: {
    title: 'No release notes yet',
    text: 'The first entry appears with the first release. Follow the channel so you don’t miss it.',
  },
  error: {
    title: 'Could not load the release history',
  },
}
export default en
