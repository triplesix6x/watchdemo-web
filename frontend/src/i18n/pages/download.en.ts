import type ru from './download.ru'

const en: typeof ru = {
  meta: {
    title: 'Download for Windows',
    description: 'Download WatchDemo for Windows: the latest version, file size, SHA-256, system requirements and install steps.',
  },
  h1: 'WatchDemo for Windows',
  lead: 'A CS2 demo manager. You run the installer once, after that the app updates itself.',
  cta: 'Download for Windows',
  version: 'Version {version}',
  channel: { stable: 'Stable', beta: 'Beta' },
  betaNote: 'You are in the beta program, so this is a test build. If something breaks, message the author.',
  changes: 'What’s new in {version}',
  sha: {
    label: 'SHA-256',
    copy: 'Copy hash',
    howTitle: 'How to check the file',
    howText: 'Open PowerShell in the folder with the downloaded file and run the command. It compares the file’s hash with the one above: True means the file arrived complete and unchanged.',
    copyCommand: 'Copy command',
  },
  loading: 'Loading build details',
  empty: {
    title: 'No build published yet',
    text: 'The installer appears here as soon as the first release is out. The Telegram channel will announce it.',
    action: 'Open the channel',
  },
  error: {
    title: 'Could not get the installer link',
  },
  shot: 'The WatchDemo home screen: the latest demo with the «Смотреть в CS2» (watch in CS2) button, your moment sets and the analysis log.',
  installTitle: 'Install',
  install: [
    'Run the downloaded file. The app installs into your user folder, no administrator rights needed.',
    'If Windows shows the SmartScreen window «Windows protected your PC», click «More info», then «Run anyway». It appears because the installer is not signed with a certificate yet.',
    'Open WatchDemo and sign in with your site account. Your email has to be confirmed.',
  ],
  noAccount: 'No account?',
  register: 'Sign up',
  reqTitle: 'What you need',
  req: [
    { term: 'System', text: 'Windows 10 or Windows 11, 64-bit.' },
    { term: 'WebView2', text: 'Microsoft Edge WebView2 Runtime. Windows 11 already has it. If it is missing, the installer downloads it, so stay online.' },
    { term: 'CS2', text: 'Installed through Steam. Needed to watch in the game, everything else works without it.' },
    { term: 'Account', text: 'A watchdemo.pro account with a confirmed email.' },
  ],
  updateTitle: 'Updates',
  updateText: 'On launch the app checks this server. When a new version is out, it downloads it, checks the signature and installs it. No need to download the installer again.',
  allReleases: 'All versions',
}
export default en
