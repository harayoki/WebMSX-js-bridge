// MP3 bridge sample for WebMSX
// Uses I/O ports 0x5A (command / status) and 0x5B (data) to control playback.

const CONFIG = {
  commandPort: 0x5a,
  dataPort: 0x5b,
  defaultFadeMs: 1200,
  defaultCrossFadeMs: 1200,
  imagesPath: "../../../../release/stable/6.0/embedded/images/",
};

const COMMANDS = {
  BGM_PLAY: 0x01,
  BGM_FADE_IN: 0x02,
  BGM_LOOP: 0x03,
  BGM_FADE_OUT: 0x04,
  BGM_CROSS_FADE: 0x05,
  SET_FADE: 0x06,
  SET_CROSS_FADE: 0x07,
  SE_PLAY: 0x11,
};

const BGM_TRACKS = [
  { id: 0, file: "bgm1.mp3", label: "BGM1" },
  { id: 1, file: "bgm2.mp3", label: "BGM2" },
  { id: 2, file: "bgm3.mp3", label: "BGM3" },
];

const SE_TRACKS = [
  { id: 0, file: "se1.mp3", label: "SE1" },
  { id: 1, file: "se2.mp3", label: "SE2" },
  { id: 2, file: "se3.mp3", label: "SE3" },
];

const logger = (() => {
  const logEl = document.querySelector("#log");
  const statusEl = document.querySelector("#status");
  return {
    info(message) {
      const line = document.createElement("div");
      line.textContent = `[INFO] ${message}`;
      logEl.appendChild(line);
      logEl.scrollTop = logEl.scrollHeight;
    },
    warn(message) {
      const line = document.createElement("div");
      line.textContent = `[WARN] ${message}`;
      line.style.color = "#fbbf24";
      logEl.appendChild(line);
      logEl.scrollTop = logEl.scrollHeight;
    },
    error(message) {
      const line = document.createElement("div");
      line.textContent = `[ERROR] ${message}`;
      line.style.color = "#f87171";
      logEl.appendChild(line);
      logEl.scrollTop = logEl.scrollHeight;
    },
    setStatus(message) {
      statusEl.textContent = message;
    },
  };
})();

class AudioLibrary {
  constructor(context) {
    this.context = context;
    this.cache = new Map();
  }

  async loadBuffer(url) {
    if (this.cache.has(url)) return this.cache.get(url);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${url}`);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = await this.context.decodeAudioData(arrayBuffer.slice(0));
    this.cache.set(url, buffer);
    return buffer;
  }

  preloadAll(manifest) {
    return Promise.all(manifest.map((entry) => this.loadBuffer(entry.file)));
  }
}

class BgmPlayer {
  constructor(context, library) {
    this.context = context;
    this.library = library;
    this.current = null;
    this.next = null;
    this.gainCurrent = context.createGain();
    this.gainNext = context.createGain();
    this.master = context.createGain();
    this.gainCurrent.connect(this.master);
    this.gainNext.connect(this.master);
    this.master.connect(context.destination);
    this.fadeMs = CONFIG.defaultFadeMs;
    this.crossFadeMs = CONFIG.defaultCrossFadeMs;
    this.isFading = false;
  }

  setFadeMs(ms) {
    this.fadeMs = Math.max(0, ms);
  }

  setCrossFadeMs(ms) {
    this.crossFadeMs = Math.max(0, ms);
  }

  status() {
    return {
      playing: !!this.current,
      trackId: this.current?.trackId ?? 0,
      fading: this.isFading,
    };
  }

  async play(trackId, { loop = false, fadeIn = false } = {}) {
    const track = BGM_TRACKS.find((t) => t.id === trackId);
    if (!track) throw new Error(`Unknown BGM id ${trackId}`);
    const buffer = await this.library.loadBuffer(track.file);
    await this._startBuffer(buffer, trackId, { loop, fadeInMs: fadeIn ? this.fadeMs : 0 });
    logger.info(`${track.label} 再生開始${loop ? " (ループ)" : ""}${fadeIn ? " (フェードイン)" : ""}`);
  }

  async crossFadeTo(trackId, { loop = true } = {}) {
    const track = BGM_TRACKS.find((t) => t.id === trackId);
    if (!track) throw new Error(`Unknown BGM id ${trackId}`);
    const buffer = await this.library.loadBuffer(track.file);
    this.isFading = true;
    const now = this.context.currentTime;
    const fadeSeconds = this.crossFadeMs / 1000;

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    const gain = this.gainNext;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + fadeSeconds);
    source.connect(gain);
    source.start();

    if (this.current) {
      this.gainCurrent.gain.cancelScheduledValues(now);
      this.gainCurrent.gain.setValueAtTime(this.gainCurrent.gain.value, now);
      this.gainCurrent.gain.linearRampToValueAtTime(0, now + fadeSeconds);
      this.current.source.stop(now + fadeSeconds + 0.05);
    }

    this.current = { source, trackId };
    this.isFading = false;
    logger.info(`${track.label} へクロスフェード (${this.crossFadeMs}ms)`);
  }

  fadeOut(optionalMs = 0) {
    if (!this.current) return;
    const ms = optionalMs > 0 ? optionalMs : this.fadeMs;
    const now = this.context.currentTime;
    const endTime = now + ms / 1000;
    this.isFading = true;
    this.gainCurrent.gain.cancelScheduledValues(now);
    this.gainCurrent.gain.setValueAtTime(this.gainCurrent.gain.value, now);
    this.gainCurrent.gain.linearRampToValueAtTime(0.0001, endTime);
    this.current.source.stop(endTime + 0.05);
    this.current = null;
    this.isFading = false;
    logger.info(`BGM フェードアウト (${ms}ms)`);
  }

  async _startBuffer(buffer, trackId, { loop, fadeInMs }) {
    if (this.current) this.current.source.stop();
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    const now = this.context.currentTime;
    this.gainCurrent.gain.cancelScheduledValues(now);
    const startGain = fadeInMs > 0 ? 0.0001 : 1;
    this.gainCurrent.gain.setValueAtTime(startGain, now);
    if (fadeInMs > 0) {
      this.isFading = true;
      this.gainCurrent.gain.linearRampToValueAtTime(1, now + fadeInMs / 1000);
    }
    source.connect(this.gainCurrent);
    source.start();
    this.current = { source, trackId };
    if (fadeInMs > 0) {
      setTimeout(() => {
        this.isFading = false;
      }, fadeInMs + 10);
    }
  }
}

class SePlayer {
  constructor(context, library) {
    this.context = context;
    this.library = library;
    this.gain = context.createGain();
    this.gain.connect(context.destination);
  }

  async play(trackId) {
    const track = SE_TRACKS.find((t) => t.id === trackId);
    if (!track) throw new Error(`Unknown SE id ${trackId}`);
    const buffer = await this.library.loadBuffer(track.file);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    source.start();
    logger.info(`${track.label} 再生`);
  }
}

class Bridge {
  constructor(context) {
    this.context = context;
    this.library = new AudioLibrary(context);
    this.bgm = new BgmPlayer(context, this.library);
    this.se = new SePlayer(context, this.library);
    this.lastData = 0;
    this.preloaded = false;
  }

  async preload() {
    await this.library.preloadAll([...BGM_TRACKS, ...SE_TRACKS]);
    this.preloaded = true;
  }

  handleData(val) {
    this.lastData = val & 0xff;
  }

  async handleCommand(cmd) {
    const param = this.lastData & 0xff;
    try {
      switch (cmd) {
        case COMMANDS.BGM_PLAY:
          await this.bgm.play(param, { loop: false, fadeIn: false });
          break;
        case COMMANDS.BGM_FADE_IN:
          await this.bgm.play(param, { loop: false, fadeIn: true });
          break;
        case COMMANDS.BGM_LOOP:
          await this.bgm.play(param, { loop: true, fadeIn: false });
          break;
        case COMMANDS.BGM_FADE_OUT: {
          const ms = param ? param * 100 : 0;
          this.bgm.fadeOut(ms);
          break;
        }
        case COMMANDS.BGM_CROSS_FADE:
          await this.bgm.crossFadeTo(param, { loop: true });
          break;
        case COMMANDS.SET_FADE:
          this.bgm.setFadeMs(param * 100);
          logger.info(`フェード時間を ${param * 100}ms に設定`);
          break;
        case COMMANDS.SET_CROSS_FADE:
          this.bgm.setCrossFadeMs(param * 100);
          logger.info(`クロスフェード時間を ${param * 100}ms に設定`);
          break;
        case COMMANDS.SE_PLAY:
          await this.se.play(param);
          break;
        default:
          logger.warn(`未対応コマンド 0x${cmd.toString(16)}`);
      }
    } catch (err) {
      logger.error(err.message);
    }
  }

  statusByte() {
    const bgmStatus = this.bgm.status();
    let status = 0;
    if (bgmStatus.playing) status |= 0x01;
    status |= (bgmStatus.trackId & 0x03) << 1;
    if (this.preloaded) status |= 0x08;
    if (bgmStatus.fading) status |= 0x10;
    return status;
  }
}

const audioContext = new (window.AudioContext || window.webkitAudioContext)();
const bridge = new Bridge(audioContext);

// Prevent automatic start from the embedded build; we will call WMSX.start manually.
window.WMSX = window.WMSX || {};
WMSX.AUTO_START = false;
WMSX.SCREEN_ELEMENT_ID = "wmsx-screen";
WMSX.IMAGES_PATH = CONFIG.imagesPath;

const preloadToggle = document.querySelector("#preload-toggle");
const startButton = document.querySelector("#start-btn");

startButton.addEventListener("click", async () => {
  startButton.disabled = true;
  logger.setStatus("初期化中...");
  try {
    await audioContext.resume();
    logger.info("AudioContext を有効化しました");
    if (preloadToggle.checked) {
      logger.setStatus("オーディオを読み込み中...");
      await bridge.preload();
      logger.info("BGM/SE を事前読み込みしました");
    } else {
      logger.info("プリロードせずに開始します");
    }
    await startWebMsx();
    logger.setStatus("MSX 起動完了");
  } catch (err) {
    logger.error(err.message);
    startButton.disabled = false;
    logger.setStatus("エラー");
  }
});

async function startWebMsx() {
  return new Promise((resolve, reject) => {
    try {
      // Ensure automatic power-on delay still runs; we simply take control of when WMSX.start is called.
      WMSX.start();
      attachBridge();
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

function attachBridge() {
  const bus = WMSX?.room?.machine?.bus;
  if (!bus) {
    throw new Error("Machine bus が取得できませんでした");
  }
  bus.connectOutputDevice(CONFIG.dataPort, (val) => bridge.handleData(val));
  bus.connectOutputDevice(CONFIG.commandPort, (val) => bridge.handleCommand(val));
  bus.connectInputDevice(CONFIG.commandPort, () => bridge.statusByte());
  logger.info(`I/O ポート 0x${CONFIG.commandPort.toString(16)} / 0x${CONFIG.dataPort.toString(16)} にブリッジを接続しました`);
}

logger.info("準備完了: MP3 ファイルを同じフォルダに配置し、[プリロードして WebMSX を開始] を押してください");
