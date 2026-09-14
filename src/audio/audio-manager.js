// Web Audio playback with event bindings, instance limiting, and an isolated
// preview bus for the part lab. Ported from framebound's AudioManager; the
// context is created up front and resumed on the first user gesture.
const VOLUME_KEYS = Object.freeze({ master: 'horde_volume_master', sfx: 'horde_volume_sfx', music: 'horde_volume_music' });
const MUSIC_FADE_SECONDS = 1.2;

export class AudioManager {
  constructor({ context = null, storage = globalThis.localStorage } = {}) {
    this.sounds = new Map();
    this.defaultSounds = new Map();
    this.eventBindings = new Map();
    this.missingSoundWarnings = new Set();
    this.previewVoices = new Set();
    this.recentPlays = new Map();
    this.storage = storage;
    this.music = null;
    this.musicPending = null;
    this.musicVoices = new Set();
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    this.context = context || (Context ? new Context() : null);
    this.available = Boolean(this.context);
    if (!this.available) return;

    this.masterGain = this.context.createGain();
    this.masterGain.connect(this.context.destination);
    this.masterGain.gain.value = 0.5;
    this.sfxGain = this.context.createGain();
    this.sfxGain.connect(this.masterGain);
    this.sfxGain.gain.value = 1;
    this.musicGain = this.context.createGain();
    this.musicGain.connect(this.masterGain);
    this.musicGain.gain.value = 0.6;
    this.previewGain = this.context.createGain();
    this.previewGain.gain.value = 0.7;
    this.previewLimiter = this.context.createDynamicsCompressor();
    this.previewLimiter.threshold.value = -6;
    this.previewLimiter.knee.value = 0;
    this.previewLimiter.ratio.value = 20;
    this.previewLimiter.attack.value = 0.003;
    this.previewLimiter.release.value = 0.12;
    this.previewGain.connect(this.previewLimiter);
    this.previewLimiter.connect(this.sfxGain);
    this.loadSettings();
  }

  loadSettings() {
    try {
      this.restoreVolume(this.masterGain, this.storage?.getItem(VOLUME_KEYS.master));
      this.restoreVolume(this.sfxGain, this.storage?.getItem(VOLUME_KEYS.sfx));
      this.restoreVolume(this.musicGain, this.storage?.getItem(VOLUME_KEYS.music));
    } catch (error) {
      console.warn('[audio] failed to load volume settings:', error);
    }
  }

  restoreVolume(gainNode, storedValue) {
    if (storedValue === null || storedValue === undefined) return;
    const parsed = Number.parseFloat(storedValue);
    if (Number.isFinite(parsed)) gainNode.gain.value = Math.max(0, Math.min(1, parsed));
  }

  saveVolume(key, value) {
    try { this.storage?.setItem(key, String(value)); } catch { /* storage is optional */ }
  }

  get masterVolume() { return this.masterGain?.gain.value ?? 0; }
  get sfxVolume() { return this.sfxGain?.gain.value ?? 0; }
  get musicVolume() { return this.musicGain?.gain.value ?? 0; }

  setMasterVolume(value) {
    if (!this.available) return;
    const v = Math.max(0, Math.min(1, value));
    this.masterGain.gain.setTargetAtTime(v, this.context.currentTime, 0.05);
    this.saveVolume(VOLUME_KEYS.master, v);
  }

  setSfxVolume(value) {
    if (!this.available) return;
    const v = Math.max(0, Math.min(1, value));
    this.sfxGain.gain.setTargetAtTime(v, this.context.currentTime, 0.05);
    this.saveVolume(VOLUME_KEYS.sfx, v);
  }

  setMusicVolume(value) {
    if (!this.available) return;
    const v = Math.max(0, Math.min(1, value));
    this.musicGain.gain.setTargetAtTime(v, this.context.currentTime, 0.05);
    this.saveVolume(VOLUME_KEYS.music, v);
  }

  // Browsers keep the context suspended until a gesture; call from pointer/key handlers.
  unlock() {
    if (!this.available) return;
    if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
    if (this.musicPending) {
      const pending = this.musicPending;
      this.musicPending = null;
      this.startMusicVoice(pending);
    }
  }

  // Long tracks stream through a media element instead of decoding into memory;
  // switching tracks crossfades so screen changes never cut the music hard.
  playMusic(trackId, url, { loop = true, fadeSeconds = MUSIC_FADE_SECONDS } = {}) {
    if (!this.available || !url) return null;
    if (this.music?.trackId === trackId) return this.music;
    this.stopMusic({ fadeSeconds });
    const element = new Audio(url);
    element.loop = loop;
    element.preload = 'auto';
    element.crossOrigin = 'anonymous';
    const gainNode = this.context.createGain();
    gainNode.gain.value = 0;
    this.context.createMediaElementSource(element).connect(gainNode);
    gainNode.connect(this.musicGain);
    const voice = { trackId, url, element, gainNode, fadeSeconds };
    this.music = voice;
    this.musicVoices.add(voice);
    this.startMusicVoice(voice);
    return voice;
  }

  startMusicVoice(voice) {
    if (!this.musicVoices.has(voice)) return;
    if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
    voice.element.play().then(() => {
      voice.gainNode.gain.cancelScheduledValues(this.context.currentTime);
      voice.gainNode.gain.setValueAtTime(0, this.context.currentTime);
      voice.gainNode.gain.linearRampToValueAtTime(1, this.context.currentTime + voice.fadeSeconds);
    }).catch((error) => {
      // Autoplay is blocked until the first gesture; unlock() retries the pending track.
      if (error?.name === 'NotAllowedError') this.musicPending = voice;
      else console.warn(`[audio] music failed: ${voice.url}`, error);
    });
  }

  stopMusic({ fadeSeconds = MUSIC_FADE_SECONDS } = {}) {
    const voice = this.music;
    if (!voice) return;
    this.music = null;
    if (this.musicPending === voice) this.musicPending = null;
    const now = this.context.currentTime;
    voice.gainNode.gain.cancelScheduledValues(now);
    voice.gainNode.gain.setValueAtTime(voice.gainNode.gain.value, now);
    voice.gainNode.gain.linearRampToValueAtTime(0, now + fadeSeconds);
    setTimeout(() => {
      voice.element.pause();
      voice.element.removeAttribute('src');
      voice.element.load();
      voice.gainNode.disconnect();
      this.musicVoices.delete(voice);
    }, fadeSeconds * 1000 + 50);
  }

  createBuffer({ samples, sampleRate }) {
    if (!this.available) return null;
    const buffer = this.context.createBuffer(1, samples.length, sampleRate);
    buffer.getChannelData(0).set(samples);
    return buffer;
  }

  async decodeAudioBytes(bytes) {
    if (!this.available) return null;
    const arrayBuffer = bytes instanceof ArrayBuffer
      ? bytes.slice(0)
      : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return this.context.decodeAudioData(arrayBuffer);
  }

  replace(name, audioBuffer, { asDefault = false } = {}) {
    if (!name || !audioBuffer) return false;
    this.sounds.set(name, audioBuffer);
    if (asDefault) this.defaultSounds.set(name, audioBuffer);
    this.missingSoundWarnings.delete(name);
    return true;
  }

  remove(name) {
    if (this.defaultSounds.has(name)) return false;
    return this.sounds.delete(name);
  }

  hasSound(name) {
    return Boolean(name && this.sounds.has(name));
  }

  bindEvent(eventKey, soundName) {
    if (!eventKey || !soundName || !this.sounds.has(soundName)) return false;
    this.eventBindings.set(eventKey, soundName);
    return true;
  }

  unbindEvent(eventKey) {
    return this.eventBindings.delete(eventKey);
  }

  getEventBinding(eventKey) {
    return this.eventBindings.get(eventKey) || null;
  }

  play(name, options = {}) {
    return this.playEvent(`global:${name}`, name, options);
  }

  // Resolution order: the event's own binding (a tower slot), then the global
  // hook the fallback names (global:<fallback>), then the built-in default.
  resolveSoundName(eventKey, fallbackName) {
    return this.eventBindings.get(eventKey)
      || (eventKey !== `global:${fallbackName}` ? this.eventBindings.get(`global:${fallbackName}`) : null)
      || fallbackName;
  }

  playEvent(eventKey, fallbackName, options = {}) {
    if (!this.available) return null;
    const name = this.resolveSoundName(eventKey, fallbackName);
    const buffer = this.sounds.get(name);
    if (!buffer) {
      if (!this.missingSoundWarnings.has(name)) {
        this.missingSoundWarnings.add(name);
        console.warn(`[audio] missing sound for ${eventKey}: ${name}`);
      }
      return null;
    }
    const now = performance.now();
    const recent = this.recentPlays.get(eventKey) || { count: 0, lastTime: now };
    // Leaky bucket: one unit drains every 2ms so bursts duck instead of stacking.
    recent.count = Math.max(0, recent.count - (now - recent.lastTime) / 2) + 1;
    recent.lastTime = now;
    this.recentPlays.set(eventKey, recent);

    let multiplier = 1;
    if (options.isSpammy) {
      if (recent.count > 1) multiplier = Math.max(0.1, 1 / Math.pow(recent.count, 0.6));
    } else if (recent.count > 5) {
      multiplier = Math.max(0.2, 2 / Math.sqrt(recent.count));
      if (recent.count > 1000) return null;
    }
    const finalVolume = (options.volume ?? 1) * multiplier;
    if (finalVolume < 0.001 || finalVolume * this.sfxGain.gain.value * this.masterGain.gain.value < 0.001) return null;
    this.unlock();

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = (options.pitch ?? 1) + (Math.random() - 0.5) * (options.randomizePitch || 0);
    const gainNode = this.context.createGain();
    gainNode.gain.value = finalVolume;
    source.connect(gainNode);
    gainNode.connect(this.sfxGain);
    source.start(0);
    return { source, gainNode };
  }

  previewSound(name, options = {}) {
    return this.preview(this.sounds.get(name), options);
  }

  preview(audioBuffer, { volume = 0.7, pitch = 1 } = {}) {
    if (!audioBuffer || !this.available) return null;
    this.stopPreview();
    this.unlock();
    const source = this.context.createBufferSource();
    const gainNode = this.context.createGain();
    source.buffer = audioBuffer;
    source.playbackRate.value = Math.max(0.1, Math.min(4, pitch));
    gainNode.gain.value = Math.max(0, Math.min(1, volume));
    source.connect(gainNode);
    gainNode.connect(this.previewGain);
    const voice = { source, gainNode };
    this.previewVoices.add(voice);
    source.onended = () => this.previewVoices.delete(voice);
    source.start(0);
    return voice;
  }

  stopPreview() {
    for (const voice of this.previewVoices) {
      try { voice.source.stop(); } catch { /* already ended */ }
    }
    this.previewVoices.clear();
  }
}
