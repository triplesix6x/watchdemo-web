import type ru from './help.ru'

// The app's interface is in Russian, so button names stay in Russian with a gloss.
const en: typeof ru = {
  meta: {
    title: 'Help',
    description: 'Installing, signing in, importing demos, watching in CS2, the F6-F9 keys, the 2D replay, plans and troubleshooting.',
  },
  h1: 'Help',
  lead: 'Answers to common questions about WatchDemo. If yours is not here, message the author on Telegram.',
  search: 'Search the questions',
  searchHint: 'For example: SmartScreen, F8, voice',
  found: 'Answers found: {count}',
  toc: 'Sections',
  noResults: {
    title: 'Nothing found for «{query}»',
    text: 'Try another word, or message the author on Telegram.',
    reset: 'Clear search',
  },
  askTitle: 'Didn’t find an answer?',
  askText: 'The author answers on Telegram. Say what you did and what you saw on screen.',
  ask: 'Message the author',
  keys: {
    caption: 'Default keys',
    key: 'Key',
    action: 'Action',
    rows: [
      { key: 'F8', action: 'Next moment in the set' },
      { key: 'F7', action: 'Previous moment' },
      { key: 'F6', action: 'Replay the current moment' },
      { key: 'F9', action: 'Load the set selected in the app' },
    ],
  },
  sections: [
    {
      id: 'install',
      title: 'Installing',
      items: [
        {
          id: 'install-how',
          q: 'How do I install WatchDemo?',
          a: 'Get the installer on the [download page](/download) and run it. The app installs into your user folder, no administrator rights needed.\n\nYou need Windows 10 or 11 (64-bit) and Microsoft Edge WebView2 Runtime. If WebView2 is missing, the installer downloads it.',
        },
        {
          id: 'smartscreen',
          q: 'Windows says «Windows protected your PC»',
          a: 'That is SmartScreen. The installer is not signed with a certificate yet, so Windows does not recognise it. Click **More info**, then **Run anyway**.\n\nTo make sure the file was not swapped, compare its SHA-256 with the hash on the [download page](/download).',
        },
        {
          id: 'updates',
          q: 'How do I update the app?',
          a: 'You don’t have to, it updates itself. On launch WatchDemo checks the server, downloads the new version, checks its signature and installs it. See [What’s new](/changelog) for the changes.',
        },
      ],
    },
    {
      id: 'first-run',
      title: 'First run and signing in',
      items: [
        {
          id: 'sign-in',
          q: 'How do I sign in to the app?',
          a: 'On the first launch a sign-in window opens. Enter the username or email and the password of your watchdemo.pro account.\n\nNo account? The **Зарегистрироваться** (sign up) button in that window opens [sign-up](/register) on the site. Confirm your email with the link from the letter before signing in.',
        },
        {
          id: 'forgot-password',
          q: 'I forgot my password',
          a: 'Click **Забыли пароль?** (forgot password) in the sign-in window or open [password reset](/forgot-password) on the site. A link for a new password arrives by email.',
        },
      ],
    },
    {
      id: 'import',
      title: 'Importing demos',
      items: [
        {
          id: 'import-how',
          q: 'How do I add demos?',
          a: 'Drag files into the app window or click **+** above the demo list. It takes `.dem` files and `.zip`, `.rar`, `.7z`, `.zst`, `.bz2` archives and pulls the demos out of them.\n\nImports count towards your plan’s monthly limit: 10 demos a month on Basic.',
        },
        {
          id: 'analysis',
          q: 'Why analyse a demo?',
          a: 'Analysis reads the whole demo: score, rosters, stats, moments and the 2D replay data. Start it with the **Анализ** (analyse) button in the demo profile.\n\nTo analyse right after import, turn on **Авто-анализ** (auto analysis) in the settings, «Общие» (general) section. Watching in CS2 does not need analysis.',
        },
      ],
    },
    {
      id: 'cs2',
      title: 'Watching in CS2',
      items: [
        {
          id: 'watch-in-cs2',
          q: 'How does «Смотреть в CS2» (watch in CS2) work?',
          a: 'The app writes its configs into the game’s `cfg` folder and starts CS2 through Steam with `-condebug`. With that flag the game writes `console.log`, which tells the app where you are in the demo.\n\nSo CS2 has to be installed through Steam, and Steam has to be installed on this computer.',
        },
        {
          id: 'voice-in-game',
          q: 'How do I hear the players’ voice chat in the game?',
          a: 'Turn on **Голосовой чат в игре** (voice chat in game) in the settings, «Общие» (general) section. Demos then open in CS2 with voice playback on.',
        },
      ],
    },
    {
      id: 'sets',
      title: 'Moment sets and keys',
      items: [
        {
          id: 'sets-what',
          q: 'What are moment sets?',
          a: 'A set collects moments from one demo so you can play them back to back in CS2. After analysis the **Моменты** (moments) tab has auto sets for the player you pick:\n\n- deaths and kills\n- opening duels won and lost\n- clutches\n- rounds lost with a man advantage\n- deaths with an unused grenade\n\nYou can save an auto set as your own. Start your own set with **+ Новый набор** (new set) and mark moments in the 2D replay. A single moment goes in with **+ в набор** (add to set).',
        },
        {
          id: 'hotkeys',
          q: 'Which keys work in CS2?',
          a: 'Click **Играть набор в CS2** (play set in CS2) and the keys below work in the game. Change them in the settings, «Управление в CS2» (CS2 controls) section. New keys take effect the next time you open a demo.',
        },
        {
          id: 'unbind',
          q: 'How do I get my own key binds back?',
          a: 'The app writes `bind` into the game config and takes these keys. To free them, click **Снять привязки** (remove binds) in the settings, «Управление в CS2» section. It applies on the next CS2 launch.\n\nThe game will not restore your old binds: the app does not know what was on those keys before WatchDemo.',
        },
      ],
    },
    {
      id: 'replay',
      title: '2D replay and voice',
      items: [
        {
          id: 'replay-what',
          q: 'What does the 2D replay do?',
          a: 'The **2D реплей** tab in the demo profile shows the round on a radar: players, grenades, the bomb, the kill feed and a timeline. It needs an analysed demo and the Plus or Pro plan.\n\nThe mouse wheel zooms the map. Drawing tools help you break a round down: hand **1**, pencil **2**, line **3**, arrow **4**, rectangle **5**, ellipse **6** and text **T**. The right mouse button erases.',
        },
        {
          id: 'replay-voice',
          q: 'How do I hear voice in the 2D replay?',
          a: 'If the demo recorded voice chat, it plays in sync with the round. In the player panel you can mute one player or the whole team, and the overall volume sits in the replay controls.',
        },
      ],
    },
    {
      id: 'plans',
      title: 'Plans and access',
      items: [
        {
          id: 'plans-get',
          q: 'How do I get Plus or Pro?',
          a: 'Message the author on [Telegram](https://t.me/zeroikins) with your account name. There is no payment on the site yet, plans are assigned by hand. See [Pricing](/pricing) for what each plan includes.',
        },
        {
          id: 'plans-refresh',
          q: 'I got a plan but the app doesn’t show it',
          a: 'The app checks your plan on launch and when you open the account window. Restart WatchDemo or open your account and the plan updates.',
        },
      ],
    },
    {
      id: 'problems',
      title: 'Troubleshooting',
      items: [
        {
          id: 'steam-not-found',
          q: '«Steam не найден» (Steam not found)',
          a: 'The app starts CS2 through Steam and could not find it on this computer. Install or start Steam and click **Смотреть в CS2** again.',
        },
        {
          id: 'cs2-not-found',
          q: '«CS2 не найдена» (CS2 not found)',
          a: 'Steam is there, but the game is not in its library. Install CS2 through Steam and try again.',
        },
        {
          id: 'keys-not-working',
          q: 'The set keys do nothing in the game',
          a: 'New keys start working the next time you open a demo: close CS2 and click **Играть набор в CS2** again. If one key is assigned to two actions, the app will not let you save the settings.',
        },
        {
          id: 'offline',
          q: '«Не удалось получить актуальную информацию по аккаунту» (could not get account info)',
          a: 'The app could not reach the server and runs as Basic for now. Check your internet connection. Once it is back, your plan loads by itself.',
        },
      ],
    },
    {
      id: 'contacts',
      title: 'Contacts',
      items: [
        {
          id: 'contact',
          q: 'How do I reach the author?',
          a: 'Write on Telegram: [@zeroikins](https://t.me/zeroikins). News, releases and beta builds go out in the [@watchdemopro](https://t.me/watchdemopro) channel.',
        },
      ],
    },
  ],
}
export default en
