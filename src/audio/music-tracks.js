// Streamed music. Tracks live in public/music and never enter the sfx library;
// the screen decides which one plays and the audio manager crossfades.
export const MUSIC_TRACKS = Object.freeze({
  menu: Object.freeze({ id: 'menu', url: './music/mainmenu.m4a', label: 'main menu' }),
  gameplay: Object.freeze({ id: 'gameplay', url: './music/gameplay.m4a', label: 'gameplay' })
});

export function musicTrackForScreen(screen) {
  if (['main', 'map_select', 'coop', 'options'].includes(screen)) return MUSIC_TRACKS.menu;
  if (['game', 'escape'].includes(screen)) return MUSIC_TRACKS.gameplay;
  return null;
}
