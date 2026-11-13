// One small interface over the web-portal SDKs, so the same game runs everywhere.
// The build sets window.PLATFORM; locally you can force one with ?platform=crazygames etc.
// Every SDK call is guarded: if a SDK is missing or fails, the game still runs offline.

const NAME = new URLSearchParams(location.search).get('platform') || window.PLATFORM || 'local';
const SAVE_KEY = 'trickyroad_save_v1';

const noop = () => {};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const lsGet = () => { try { return localStorage.getItem(SAVE_KEY); } catch (e) { return null; } };
// pick the save that was written last (the cloud copy can lag a few seconds behind the local one)
const seen = (s) => { try { return JSON.parse(s).lastSeen || 0; } catch (e) { return -1; } };
const newest = (a, b) => (!a ? b : !b ? a : seen(b) > seen(a) ? b : a);
const lsSet = (s) => { try { localStorage.setItem(SAVE_KEY, s); } catch (e) { /* storage blocked */ } };

// Base adapter = plain browser (also the fallback when a SDK fails to load).
const base = {
  name: NAME,
  hasRewarded: false,
  adColor: 'green',            // colour of the "watch an ad" buttons
  ownPauseEvents: false,       // true: the portal sends pause/resume, the page must not use the Visibility API
  ownAudioControl: false,      // true: the portal has its own mute switch, hide the in-game sound settings
  async init() {},
  loadingDone: noop,           // first frame is on screen and the game can be played
  gameplayStart: noop,
  gameplayStop: noop,
  happytime: noop,             // a moment of joy (level won, world cleared)
  // ads: onStart() is called when an ad really starts playing (mute there); the promise resolves when it's over
  async interstitial(onStart) {},
  async rewarded(onStart) { return false; },
  async loadSave() { return lsGet(); },
  writeSave(s) { lsSet(s); },
  writeLocal(s) { lsSet(s); },  // fast refresh-safe copy between (throttled) cloud saves
  lang() { return new URLSearchParams(location.search).get('lang') || navigator.language || 'en'; },
  // hooks the game fills in
  onPause: noop, onResume: noop, onAudio: noop,
};

const adapters = {
  local: {
    hasRewarded: true,         // fake ads so the flow can be tested without a portal
    async interstitial(onStart) { console.log('[platform] interstitial (simulated)'); onStart?.(); await wait(300); },
    async rewarded(onStart) { console.log('[platform] rewarded (simulated)'); onStart?.(); await wait(800); return true; },
  },

  crazygames: {
    hasRewarded: true,
    sdk: null,
    async init() {
      const sdk = window.CrazyGames && window.CrazyGames.SDK;
      if (!sdk) return;
      await sdk.init();
      if (sdk.environment === 'disabled') return;   // not on CrazyGames / localhost: every call would throw
      this.sdk = sdk;
      sdk.game.loadingStart();
      // the site-wide mute setting wins over the in-game sound toggles
      const applyMute = (st) => this.onAudio(!(st && st.muteAudio));
      sdk.game.addSettingsChangeListener?.(applyMute);
      setTimeout(() => applyMute(sdk.game.settings), 0);
      // no rewarded buttons that do nothing: hide them for players with an adblocker
      sdk.ad.hasAdblock?.().then((on) => { if (on) this.hasRewarded = false; }).catch(noop);
    },
    lang() { return this.sdk?.user?.systemInfo?.locale || 'en'; },
    loadingDone() { this.sdk?.game.loadingStop(); },
    gameplayStart() { this.sdk?.game.gameplayStart(); },
    gameplayStop() { this.sdk?.game.gameplayStop(); },
    happytime() { this.sdk?.game.happytime(); },
    ad(type, onStart) {
      return new Promise((resolve) => {
        if (!this.sdk) return resolve(false);
        let started = false, done = false;
        const end = (v) => { if (!done) { done = true; resolve(v); } };
        this.sdk.ad.requestAd(type, {
          adStarted: () => { started = true; onStart?.(); },
          adFinished: () => end(true),
          adError: (e) => {
            // ads switched off for this session (Basic Launch, kids mode) or blocked: stop offering rewarded ads
            if (e && (e.code === 'adsDisabled' || e.code === 'adblock')) this.hasRewarded = false;
            end(false);
          },
        });
        setTimeout(() => { if (!started) end(false); }, 15000);
      });
    },
    async interstitial(onStart) { await this.ad('midgame', onStart); },
    rewarded(onStart) { return this.ad('rewarded', onStart); },
    // Progress lives only in the CrazyGames Data module (it keeps guests in local storage itself and syncs accounts)
    async loadSave() { if (!this.sdk) return lsGet(); try { return this.sdk.data.getItem(SAVE_KEY); } catch (e) { return null; } },
    writeSave(s) { if (!this.sdk) return lsSet(s); try { this.sdk.data.setItem(SAVE_KEY, s); } catch (e) { /* data limit / disabled */ } },
    writeLocal(s) { this.writeSave(s); },
  },

  poki: {
    hasRewarded: true,
    adColor: 'orange',         // Poki: rewarded buttons must not be green
    ok: false,
    async init() {
      if (!window.PokiSDK) return;
      try { await window.PokiSDK.init(); } catch (e) { /* ad blocker: game still works */ }
      this.ok = true;
    },
    loadingDone() { if (this.ok) window.PokiSDK.gameLoadingFinished(); },
    gameplayStart() { if (this.ok) window.PokiSDK.gameplayStart(); },
    gameplayStop() { if (this.ok) window.PokiSDK.gameplayStop(); },
    async interstitial(onStart) { if (this.ok) try { await window.PokiSDK.commercialBreak(onStart); } catch (e) { /* skip */ } },
    async rewarded(onStart) {
      if (!this.ok) return false;
      try { return !!(await window.PokiSDK.rewardedBreak(onStart)); } catch (e) { return false; }
    },
  },

  yandex: {
    hasRewarded: true,
    ysdk: null, player: null,
    async init() {
      if (!window.YaGames) return;
      this.ysdk = await window.YaGames.init();
      try { this.player = await this.ysdk.getPlayer({ scopes: false }); } catch (e) { /* guest */ }
      this.ysdk.on?.('game_api_pause', () => this.onPause());
      this.ysdk.on?.('game_api_resume', () => this.onResume());
    },
    // the catalog language the player chose on Yandex Games
    lang() { return this.ysdk?.environment?.i18n?.lang || base.lang(); },
    loadingDone() { this.ysdk?.features?.LoadingAPI?.ready(); },
    gameplayStart() { this.ysdk?.features?.GameplayAPI?.start(); },
    gameplayStop() { this.ysdk?.features?.GameplayAPI?.stop(); },
    interstitial(onStart) {
      return new Promise((resolve) => {
        if (!this.ysdk) return resolve();
        this.ysdk.adv.showFullscreenAdv({ callbacks: { onOpen: () => onStart?.(), onClose: () => resolve(), onError: () => resolve() } });
      });
    },
    rewarded(onStart) {
      return new Promise((resolve) => {
        if (!this.ysdk) return resolve(false);
        let got = false;
        this.ysdk.adv.showRewardedVideo({ callbacks: {
          onOpen: () => onStart?.(),
          onRewarded: () => { got = true; },
          onClose: () => resolve(got),
          onError: () => resolve(false),
        } });
      });
    },
    async loadSave() {
      let cloud = null;
      try { const d = await this.player?.getData(['save']); if (d && d.save) cloud = d.save; } catch (e) { /* fall back */ }
      return newest(cloud, lsGet());
    },
    writeSave(s) { lsSet(s); try { this.player?.setData({ save: s }); } catch (e) { /* ignore */ } },
  },

  // GameDistribution (gdsdk). build.py puts window.GD_OPTIONS (gameId + an onEvent that queues events) and the SDK
  // <script> in <head>; this adapter drains that queue. The game already pauses + mutes around interstitial()/rewarded();
  // SDK_GAME_PAUSE during our request = the ad really started (onStart mutes); a pause the SDK starts by itself
  // (e.g. its own pre-roll) goes through onPause/onResume, always as one pair.
  gamedistribution: {
    hasRewarded: true,
    ok: false, inAd: null, extPaused: false,
    async init() {
      const q = window.__gdq || [];
      window.__gdOnEvent = (e) => this.event(e);
      q.splice(0).forEach((e) => this.event(e));
      // ad blockers stop the SDK script: then the game runs without ads (no dead 🎬 buttons)
      for (let i = 0; i < 40 && !window.gdsdk && !window.__gdFailed; i++) await wait(100);
      if (!window.gdsdk || typeof window.gdsdk.showAd !== 'function') { this.hasRewarded = false; return; }
      this.ok = true;
    },
    event(e) {
      const n = e && e.name;
      if (n === 'SDK_GAME_PAUSE') {
        if (this.inAd) this.inAd.started();
        else if (!this.extPaused) { this.extPaused = true; this.onPause(); }
      } else if (n === 'SDK_GAME_START') {
        if (this.inAd) this.inAd.ended();
        if (this.extPaused) { this.extPaused = false; this.onResume(); }
      } else if (n === 'SDK_REWARDED_WATCH_COMPLETE') {
        if (this.inAd) this.inAd.reward = true;
      }
    },
    ad(type, onStart) {
      return new Promise((resolve) => {
        if (!this.ok || this.inAd) return resolve(false);
        let started = false, done = false;
        const a = (this.inAd = { reward: false });
        const end = (shown) => {
          if (done) return; done = true;
          // the reward event can land just after the promise; give it a moment
          setTimeout(() => { this.inAd = null; resolve(type === 'rewarded' ? a.reward : shown); }, type === 'rewarded' && !a.reward ? 300 : 0);
        };
        a.started = () => { if (!started) { started = true; onStart?.(); } };
        a.ended = () => { if (started) end(true); };
        const sdk = window.gdsdk;
        const show = type === 'rewarded' && sdk.preloadAd ? sdk.preloadAd('rewarded').then(() => sdk.showAd('rewarded')) : sdk.showAd(type);
        Promise.resolve(show).then(() => end(true), () => end(false));
        setTimeout(() => { if (!started) end(false); }, 15000);   // no fill / stuck request: give the game back
        setTimeout(() => end(started), 120000);                    // safety net: never freeze the game for good
      });
    },
    async interstitial(onStart) { await this.ad('interstitial', onStart); },
    rewarded(onStart) { return this.ad('rewarded', onStart); },
  },

  youtube: {
    yt: null,
    ownPauseEvents: true,
    ownAudioControl: true,
    async init() {
      const yt = window.ytgame;
      if (!yt || !yt.IN_PLAYABLES_ENV) return;
      this.yt = yt;
      yt.system.onPause(() => this.onPause());
      yt.system.onResume(() => this.onResume());
      yt.system.onAudioEnabledChange?.((on) => this.onAudio(on));
      setTimeout(() => this.onAudio(yt.system.isAudioEnabled()), 0);
      if (yt.ads?.requestRewardedAd) this.hasRewarded = true;
    },
    lang() { try { return this.yt?.system.getLanguage() || 'en'; } catch (e) { return 'en'; } },
    loadingDone() {
      if (!this.yt) return;
      this.yt.game.firstFrameReady();
      this.yt.game.gameReady();
    },
    async interstitial(onStart) {
      try { if (this.yt?.ads?.requestInterstitialAd) { onStart?.(); await this.yt.ads.requestInterstitialAd(); } } catch (e) { /* no fill */ }
    },
    async rewarded(onStart) {
      if (!this.yt?.ads?.requestRewardedAd) return false;
      try { onStart?.(); return !!(await this.yt.ads.requestRewardedAd('reward')); } catch (e) { return false; }
    },
    async loadSave() {
      if (!this.yt) return lsGet();
      try { return (await this.yt.game.loadData()) || null; } catch (e) { return null; }
    },
    writeSave(s) { if (this.yt) this.yt.game.saveData(s).catch(noop); else lsSet(s); },
  },
};

export const platform = Object.assign(Object.create(null), base, adapters[NAME] || {});

// Send gameplay start/stop only when the state really changes (portals throttle or flag repeated calls).
let playing = false;
const rawStart = platform.gameplayStart, rawStop = platform.gameplayStop;
platform.gameplayStart = function () { if (!playing) { playing = true; rawStart.call(platform); } };
platform.gameplayStop = function () { if (playing) { playing = false; rawStop.call(platform); } };

// Wrap init so a broken SDK falls back to the plain-browser adapter.
const rawInit = platform.init;
platform.init = async function () {
  try { await Promise.race([rawInit.call(platform), wait(8000)]); }
  catch (e) { console.warn('[platform] init failed, running offline', e); }
};
