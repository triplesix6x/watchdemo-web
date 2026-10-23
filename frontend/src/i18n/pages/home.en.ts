import type ru from './home.ru'

const en: typeof ru = {
  meta: {
    description:
      'A CS2 demo manager for Windows: a demo library, automatic moment sets, your own sets, a 2D replay with voice and one-click playback in the game.',
  },
  hero: {
    title: 'Any demo moment, in CS2, in one click',
    lead: 'WatchDemo keeps your demos in one library, finds kills, clutches and openings on its own, and opens the moment you need right in the game.',
    download: 'Download for Windows',
    how: 'How it works',
    platform: 'Windows 10 and 11',
    version: 'version {version}',
  },
  radar: {
    alt: '2D radar of de_mirage: round 13 of Falcons vs Spirit, ten players, the plant on A and the retake',
    caption: 'Falcons vs Spirit, de_mirage, round 13. Real demo data, player names hidden.',
    slider: 'Round time',
    emptyAlt: 'An empty de_mirage radar: the round has not started and nobody is on the map',
    emptyCaption: 'de_mirage. Nothing has happened in this round yet.',
  },
  chapters: {
    sets: {
      event: 'bomb planted on A',
      title: 'Your own moment sets',
      text: 'Mark moments in the 2D replay and they become a set. “Play set in CS2” opens the demo at the first moment, and the keys below step through the set inside the game.',
      alt: 'A set panel in WatchDemo: nineteen kills listed by round and the Play set in CS2 button',
    },
    moments: {
      event: 'first kill',
      title: 'Auto sets find the moments for you',
      text: 'After analysis a demo is split into auto sets for every player: kills, deaths, won and lost openings, clutches, deaths with utility still in hand. Play an auto set in CS2 as a whole or save it to your sets.',
      alt: 'The Moments tab in WatchDemo: a player’s auto sets with moment counts and Play buttons',
    },
    replay: {
      event: 'the retake, seven kills in ten seconds',
      title: '2D replay with voice',
      text: 'The round on the radar: positions, view direction, grenades and the bomb. Team voice plays in step with the map, speed runs from 0.25x to 8x, and you can draw on the map with lines, arrows, boxes and text.',
      alt: 'The 2D replay in WatchDemo: the de_mirage radar with players, drawing tools on the left, team rosters on the right and the round timeline below',
    },
    notes: {
      event: 'bomb defused, round to CT',
      title: 'Notes, groups and stats',
      text: 'Write notes with timecodes on any demo. Sort demos into groups and find them by name. The Info tab shows the score, the rosters and every player’s stats: K/D, ADR and rating.',
      alt: 'The Info tab in WatchDemo: an 8 to 13 score on de_mirage and stat tables for both teams',
    },
  },
  keys: [
    { key: 'F8', label: 'Next moment' },
    { key: 'F7', label: 'Previous moment' },
    { key: 'F6', label: 'Replay current' },
    { key: 'F9', label: 'Reload set' },
  ],
  keysLabel: 'Keys in CS2',
  keysHint: 'You can rebind them in the app settings.',
  pricing: {
    text: 'Basic, Plus and Pro differ in demos per month, the 2D replay and advanced stats.',
    link: 'Compare plans',
  },
  final: {
    title: 'Open your own demo',
    text: 'Add demos by dragging them into the app window. Watching in the game needs CS2 installed.',
  },
}
export default en
