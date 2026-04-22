import { invoke } from '@tauri-apps/api/core';

// ─────────────────────────────────────────────────────────────────────────────
//  FFmpegVideo — Web Component (multi-instância)
//
//  v4 — diagnóstico + fallbacks de áudio:
//  ─ <audio> fora do Shadow DOM (Tauri/WKWebView trata media policy melhor)
//  ─ autoplay gesture unlock (play após 1ª interação do usuário)
//  ─ logs verbosos (toda falha de MSE/autoplay aparece no console)
//  ─ fallback Web Audio API se MSE falhar silenciosamente
// ─────────────────────────────────────────────────────────────────────────────

interface FrameMeta {
  pts:            number;
  duration:       number;
  video_width:    number;
  video_height:   number;
  fps:            number;
  sample_rate:    number;
  audio_channels: number;
  has_audio:      boolean;
  loop_restart:   boolean;
}

interface QueuedFrame {
  pts: number;
  y:   Uint8Array;
  u:   Uint8Array;
  v:   Uint8Array;
  w:   number;
  h:   number;
}

let __seq = 0;
const newSessionId = () =>
  `ffv${Date.now().toString(36)}${(++__seq).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

function isWindows(): boolean {
  const uaData = (navigator as any).userAgentData;
  if (uaData?.platform) return /win/i.test(uaData.platform);
  return /Windows/i.test(navigator.userAgent);
}

function toPlainU8(src: Uint8Array): Uint8Array {
  const out = new Uint8Array(new ArrayBuffer(src.byteLength));
  out.set(src);
  return out;
}

// ── Gesture unlock global ──────────────────────────────────────────────────
//
//  Muitos WebViews bloqueiam autoplay de <audio> até a 1ª interação do usuário.
//  Mantemos uma promise global que resolve no 1º click/key/touch — e
//  TODAS as instâncias de FFmpegVideo esperam por ela antes de dar play().
//
let __gestureUnlocked = false;
const __gestureWaiters: (() => void)[] = [];

function __onGesture() {
  if (__gestureUnlocked) return;
  __gestureUnlocked = true;
  const pending = __gestureWaiters.splice(0);
  pending.forEach(fn => fn());
  window.removeEventListener('click',      __onGesture, true);
  window.removeEventListener('keydown',    __onGesture, true);
  window.removeEventListener('touchstart', __onGesture, true);
  window.removeEventListener('pointerdown', __onGesture, true);
}
window.addEventListener('click',       __onGesture, true);
window.addEventListener('keydown',     __onGesture, true);
window.addEventListener('touchstart',  __onGesture, true);
window.addEventListener('pointerdown', __onGesture, true);

function waitForGesture(): Promise<void> {
  if (__gestureUnlocked) return Promise.resolve();
  return new Promise(res => __gestureWaiters.push(res));
}

export class FFmpegVideo extends HTMLElement {

  public duration    = 0;
  public paused      = true;
  public ended       = false;
  public readyState  = 0;
  public videoWidth  = 0;
  public videoHeight = 0;

  private _currentTime = 0;
  get currentTime(): number { return this._currentTime; }
  set currentTime(v: number) {
    if (!isFinite(v) || v < 0) return;
    this._currentTime = v;
    if (this._playing) this.seek(v).catch(() => {});
  }

  private _rate = 1.0;
  private _fps  = 30;

  get playbackRate()      { return this._rate; }
  set playbackRate(v: number) {
    this._rate = Math.max(0.25, Math.min(4.0, v));
    this._sendCmd({ cmd: 'set_rate', rate: this._rate });
  }

  private readonly _sessionId = newSessionId();

  private _canvas!: HTMLCanvasElement;
  private _audio!:  HTMLAudioElement;

  private _gl!: WebGLRenderingContext | WebGL2RenderingContext;
  private _isGL2 = false;
  private _prog!: WebGLProgram;
  private _texY!: WebGLTexture;
  private _texU!: WebGLTexture;
  private _texV!: WebGLTexture;
  private _pboY: WebGLBuffer | null = null;
  private _pboU: WebGLBuffer | null = null;
  private _pboV: WebGLBuffer | null = null;
  private _glReady = false;
  private _texW = 0;
  private _texH = 0;

  private _ws:     WebSocket | null = null;
  private _ctrlWs: WebSocket | null = null;

  private _queue: QueuedFrame[] = [];
  private _maxQueue = 12;

  private _wallStart   = 0;
  private _ptsStart    = 0;
  private _clockSeeded = false;
  private _rafId       = 0;

  private _domConnected = false;
  private _playing      = false;
  private _renderW      = 1920;
  private _renderH      = 1080;
  private _firstFrame   = true;
  private _retryTimer:  ReturnType<typeof setTimeout> | null = null;
  private _audioRetry:  ReturnType<typeof setTimeout> | null = null;
  private _renderAudio  = false;

  private _mediaSource:  MediaSource | null = null;
  private _sourceBuffer: SourceBuffer | null = null;
  private _audioAbort:   AbortController | null = null;
  private _audioReader:  ReadableStreamDefaultReader<Uint8Array> | null = null;
  private _audioPending: Uint8Array[] = [];
  private _audioURL:     string | null = null;

  // Log prefix por sessão para debug de múltiplas instâncias
  private get _tag() { return `[FFmpegVideo ${this._sessionId.slice(-6)}]`; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._buildDOM();
  }

  static get observedAttributes() {
    return ['src', 'width', 'height', 'autoplay', 'muted', 'loop', 'volume', 'playbackrate'];
  }

  connectedCallback() {
    this._domConnected = true;
    this._initGL();

    // O <audio> vive no light DOM do próprio elemento (fora do shadow).
    // Alguns WebViews não aplicam media policies corretamente dentro de
    // shadow DOM fechado.
    if (!this._audio.parentNode) this.appendChild(this._audio);

    this._audio.muted  = this.muted;
    this._audio.volume = this.volume;
    if (this.hasAttribute('autoplay') && this.src) this.play();
  }

  disconnectedCallback() {
    this._domConnected = false;
    this._teardown();
    invoke('stop_video', { sessionId: this._sessionId }).catch(() => {});
  }

  attributeChangedCallback(name: string, prev: string | null, val: string | null) {
    if (prev === val) return;
    switch (name) {
      case 'width':
        if (val) { this._renderW = +val; this._canvas.width  = this._renderW; }
        break;
      case 'height':
        if (val) { this._renderH = +val; this._canvas.height = this._renderH; }
        break;
      case 'volume':       this._audio.volume = this.volume; break;
      case 'muted':        this._audio.muted  = this.muted;  break;
      case 'playbackrate': if (val) this.playbackRate = +val; break;
      case 'src':          if (val && this._domConnected && this._playing) this.play(); break;
    }
  }

  get src()  { return this.getAttribute('src'); }
  set src(v) { v ? this.setAttribute('src', v) : this.removeAttribute('src'); }

  get muted() { return this.hasAttribute('muted'); }
  set muted(v: boolean) {
    v ? this.setAttribute('muted', '') : this.removeAttribute('muted');
    this._audio.muted = v;
    if (v) this._stopAudio();
    else if (this._playing && this._renderAudio) this._connectAudio();
  }

  get loop() { return this.hasAttribute('loop'); }
  set loop(v: boolean) {
    v ? this.setAttribute('loop', '') : this.removeAttribute('loop');
    this._sendCmd({ cmd: 'set_loop', enabled: v });
  }

  get volume() { return parseFloat(this.getAttribute('volume') ?? '1'); }
  set volume(v: number) {
    const c = Math.max(0, Math.min(1, v));
    this.setAttribute('volume', String(c));
    this._audio.volume = c;
  }

  async play(): Promise<void> {
    const src = this.src;
    if (!src) return;

    this._teardown();
    this._playing     = true;
    this.paused       = false;
    this.ended        = false;
    this._firstFrame  = true;
    this._clockSeeded = false;
    this._queue       = [];

    const w     = this._renderW;
    const h     = this._renderH;
    const audio = !this.muted;
    const loop  = this.loop;
    const path  = this._resolvePath(src);

    this._renderAudio = audio;

    try {
      await invoke('play_video', {
        sessionId:   this._sessionId,
        path, width: w, height: h,
        renderAudio: audio,
        loopVideo:   loop,
      });
    } catch (e) {
      console.error(`${this._tag} play_video falhou:`, e);
      this._playing = false;
      this.paused   = true;
      return;
    }

    this.dispatchEvent(new Event('play'));
    this.dispatchEvent(new Event('playing'));

    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      if (!this._playing) return;
      this._connectVideoWS();
      this._connectCtrlWS();
      if (audio) this._connectAudio();
    }, 500);
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this._sendCmd({ cmd: 'pause' });
    this._audio.pause();
    this.dispatchEvent(new Event('pause'));
  }

  resume(): void {
    if (!this.paused || !this._playing) return;
    this.paused = false;
    this._sendCmd({ cmd: 'play' });

    if (this._clockSeeded && this._queue.length > 0) {
      this._wallStart = performance.now();
      this._ptsStart  = this._queue[0].pts;
    }
    this._audio.play().catch(err =>
      console.warn(`${this._tag} resume audio.play():`, err));
    this.dispatchEvent(new Event('play'));
  }

  async seek(time: number): Promise<void> {
    this.dispatchEvent(new Event('seeking'));
    this._currentTime = time;
    this._queue       = [];
    this._firstFrame  = true;
    this._clockSeeded = false;

    try {
      await invoke('send_video_command', {
        sessionId: this._sessionId,
        command:   { cmd: 'seek', time },
      });
    } catch (e) {
      console.warn(`${this._tag} seek invoke falhou:`, e);
      this._sendCmd({ cmd: 'seek', time });
    }

    this._stopAudio();
    if (this._renderAudio && !this.muted) {
      if (this._audioRetry) clearTimeout(this._audioRetry);
      this._audioRetry = setTimeout(() => {
        this._audioRetry = null;
        this._connectAudio();
      }, 400);
    }
    this.dispatchEvent(new Event('seeked'));
  }

  private _connectVideoWS(retries = 12): void {
    if (!this._playing) return;

    const ws = new WebSocket(`ws://127.0.0.1:9001/${this._sessionId}`);
    ws.binaryType = 'arraybuffer';
    this._ws = ws;

    ws.onopen = () => this._startRenderLoop();
    ws.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
      if (!this._playing) return;
      this._enqueue(new Uint8Array(data));
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (!this._playing) return;
      if (retries > 0) {
        this._retryTimer = setTimeout(() => {
          this._retryTimer = null;
          this._connectVideoWS(retries - 1);
        }, 350);
      } else {
        this._playing = false;
        this.paused   = true;
        this.dispatchEvent(new Event('error'));
      }
    };
  }

  private _connectCtrlWS(retries = 5): void {
    if (!this._playing) return;
    const ws = new WebSocket(`ws://127.0.0.1:9003/${this._sessionId}`);
    this._ctrlWs = ws;
    ws.onclose = () => {
      this._ctrlWs = null;
      if (this._playing && retries > 0)
        setTimeout(() => this._connectCtrlWS(retries - 1), 400);
    };
    ws.onerror = () => {};
  }

  private _sendCmd(cmd: object): void {
    if (this._ctrlWs?.readyState === WebSocket.OPEN)
      this._ctrlWs.send(JSON.stringify(cmd));
  }

  // ── ÁUDIO ─────────────────────────────────────────────────────────────────

  private async _connectAudio(): Promise<void> {
    if (!this._playing || this.muted) return;

    if (!('MediaSource' in window)) {
      console.warn(`${this._tag} MediaSource indisponível`);
      return;
    }

    const mime = 'audio/mp4; codecs="mp4a.40.2"';
    if (!MediaSource.isTypeSupported(mime)) {
      console.warn(`${this._tag} audio/mp4 AAC-LC não suportado`);
      return;
    }

    this._audioAbort = new AbortController();
    const url = `http://127.0.0.1:9002/${this._sessionId}/stream.mp4?t=${Date.now()}`;
    console.log(`${this._tag} fetch áudio:`, url);

    try {
      const res = await fetch(url, { signal: this._audioAbort.signal });
      console.log(`${this._tag} fetch áudio resposta:`, res.status, res.headers.get('content-type'));
      if (!res.ok || !res.body) {
        console.warn(`${this._tag} fetch áudio falhou:`, res.status);
        return;
      }
      this._setupMediaSource(mime);
      await this._pumpToMediaSource(res.body.getReader());
    } catch (e: any) {
      if (e.name !== 'AbortError')
        console.warn(`${this._tag} áudio erro:`, e);
    }
  }

  private _setupMediaSource(mime: string): void {
    const ms = new MediaSource();
    this._mediaSource = ms;
    this._audioURL    = URL.createObjectURL(ms);

    // Listeners de diagnóstico
    ms.addEventListener('sourceopen',   () => console.log(`${this._tag} MSE sourceopen`));
    ms.addEventListener('sourceclose',  () => console.log(`${this._tag} MSE sourceclose`));
    ms.addEventListener('sourceended',  () => console.log(`${this._tag} MSE sourceended`));

    this._audio.src    = this._audioURL;
    this._audio.volume = this.volume;
    this._audio.muted  = this.muted;

    // Diagnóstico do elemento <audio>
    this._audio.onerror = () => {
      const err = this._audio.error;
      console.warn(`${this._tag} <audio> error:`, err?.code, err?.message);
    };
    this._audio.oncanplay = () => console.log(`${this._tag} <audio> canplay`);
    this._audio.onplaying = () => console.log(`${this._tag} <audio> playing`);
    this._audio.onstalled = () => console.warn(`${this._tag} <audio> stalled`);

    ms.addEventListener('sourceopen', () => {
      try {
        const sb = ms.addSourceBuffer(mime);
        sb.mode = 'sequence';
        this._sourceBuffer = sb;

        sb.addEventListener('updateend', () => this._drainAudio());
        sb.addEventListener('error',     (e) => console.warn(`${this._tag} SourceBuffer error:`, e));
        sb.addEventListener('abort',     ()  => console.warn(`${this._tag} SourceBuffer abort`));

        this._drainAudio();
        this._tryAutoplay();
      } catch (e) {
        console.warn(`${this._tag} addSourceBuffer:`, e);
      }
    }, { once: true });
  }

  /// Tenta tocar o áudio. Se for bloqueado por autoplay policy, aguarda
  /// gesture global e tenta de novo.
  private _tryAutoplay(): void {
    const playPromise = this._audio.play();
    if (!playPromise || typeof playPromise.then !== 'function') return;

    playPromise.catch(err => {
      console.warn(`${this._tag} autoplay bloqueado (${err.name}) — aguardando gesture...`);
      waitForGesture().then(() => {
        if (!this._playing || this.muted) return;
        this._audio.play()
          .then(() => console.log(`${this._tag} áudio destravado após gesture`))
          .catch(e2 => console.warn(`${this._tag} play após gesture falhou:`, e2));
      });
    });
  }

  private async _pumpToMediaSource(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    this._audioReader = reader;
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        console.log(`${this._tag} stream áudio done, total=${totalBytes} bytes`);
        try {
          if (this._mediaSource?.readyState === 'open')
            this._mediaSource.endOfStream();
        } catch {}
        break;
      }
      if (!value) continue;
      totalBytes += value.byteLength;
      this._audioPending.push(toPlainU8(value));
      this._drainAudio();
    }
  }

  private _drainAudio(): void {
    const sb = this._sourceBuffer;
    if (!sb || sb.updating || this._audioPending.length === 0) return;

    const chunk = this._audioPending.shift()!;
    try {
      sb.appendBuffer(chunk);
    } catch (e: any) {
      if (e.name === 'QuotaExceededError') {
        try {
          const b = sb.buffered;
          if (b.length > 0) sb.remove(b.start(0), b.start(0) + 10);
        } catch {}
        this._audioPending.unshift(chunk);
      } else {
        console.warn(`${this._tag} appendBuffer:`, e);
      }
    }
  }

  private _stopAudio(): void {
    if (this._audioRetry) { clearTimeout(this._audioRetry); this._audioRetry = null; }

    if (this._audioAbort)  { try { this._audioAbort.abort();  } catch {} this._audioAbort  = null; }
    if (this._audioReader) { try { this._audioReader.cancel();} catch {} this._audioReader = null; }
    this._audioPending = [];

    if (this._sourceBuffer && this._mediaSource?.readyState === 'open') {
      try { this._mediaSource.endOfStream(); } catch {}
    }
    this._sourceBuffer = null;
    this._mediaSource  = null;

    this._audio.onerror  = null;
    this._audio.oncanplay = null;
    this._audio.onplaying = null;
    this._audio.onstalled = null;
    this._audio.pause();
    this._audio.removeAttribute('src');
    this._audio.load();

    if (this._audioURL) { URL.revokeObjectURL(this._audioURL); this._audioURL = null; }
  }

  // ── Queue ─────────────────────────────────────────────────────────────────

  private _enqueue(data: Uint8Array): void {
    const sep = data.indexOf(0x7C);
    if (sep === -1) return;

    let meta: FrameMeta;
    try {
      meta = JSON.parse(new TextDecoder().decode(data.subarray(0, sep)));
    } catch { return; }

    const rw = meta.video_width  | 0;
    const rh = meta.video_height | 0;
    if (rw <= 0 || rh <= 0 || (rw & 1) !== 0 || (rh & 1) !== 0) return;

    const cw = rw >> 1;
    const ch = rh >> 1;
    const ySize  = rw * rh;
    const uvSize = cw * ch;
    const expected = ySize + uvSize * 2;

    const pixels = data.subarray(sep + 1);
    if (pixels.byteLength < expected) return;

    const y = pixels.subarray(0,              ySize);
    const u = pixels.subarray(ySize,          ySize + uvSize);
    const v = pixels.subarray(ySize + uvSize, ySize + uvSize * 2);

    if (this._firstFrame) {
      this.duration    = meta.duration;
      this.videoWidth  = meta.video_width;
      this.videoHeight = meta.video_height;
      this._fps        = meta.fps > 0 ? meta.fps : 30;
      this.readyState  = 4;
      this.dispatchEvent(new Event('loadedmetadata'));
      this.dispatchEvent(new Event('canplaythrough'));
    }

    if (meta.loop_restart) {
      this._wallStart   = performance.now();
      this._ptsStart    = meta.pts;
      this._clockSeeded = true;
    }

    if (this._queue.length >= this._maxQueue) this._queue.shift();
    this._queue.push({ pts: meta.pts, y, u, v, w: rw, h: rh });

    if (this._firstFrame) {
      this._firstFrame  = false;
      this._wallStart   = performance.now();
      this._ptsStart    = meta.pts;
      this._clockSeeded = true;
    }
  }

  // ── Render loop ───────────────────────────────────────────────────────────

  private _startRenderLoop(): void {
    if (this._rafId) return;

    const tick = (now: DOMHighResTimeStamp) => {
      if (!this._playing) return;
      this._rafId = requestAnimationFrame(tick);

      if (this.paused || !this._clockSeeded || this._queue.length === 0) return;

      const elapsed   = (now - this._wallStart) / 1000;
      const targetPts = this._ptsStart + elapsed * this._rate;
      const tol       = 0.5 / Math.max(this._fps, 1);

      while (this._queue.length > 1 && this._queue[0].pts < targetPts - tol)
        this._queue.shift();

      const frame = this._queue[0];
      if (!frame) return;
      if (frame.pts > targetPts + 2 / this._fps) return;

      this._queue.shift();
      this._currentTime = frame.pts;
      this.dispatchEvent(new CustomEvent('timeupdate', {
        detail: { currentTime: this._currentTime },
      }));

      this._drawYUV(frame.y, frame.u, frame.v, frame.w, frame.h);

      if (!this.loop && this.duration > 0
          && this._currentTime >= this.duration - 1 / this._fps
          && this._queue.length === 0) {
        this.ended    = true;
        this.paused   = true;
        this._playing = false;
        this.dispatchEvent(new Event('ended'));
      }
    };

    this._rafId = requestAnimationFrame(tick);
  }

  // ── WebGL ─────────────────────────────────────────────────────────────────

  private _initGL(): void {
    const gl = this._gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    const VS = `
      attribute vec2 a_pos;
      varying   vec2 v_uv;
      void main() {
        gl_Position = vec4(a_pos, 0.0, 1.0);
        v_uv = vec2((a_pos.x + 1.0) * 0.5, 1.0 - (a_pos.y + 1.0) * 0.5);
      }`;

    const FS = `
      precision mediump float;
      uniform sampler2D u_Y, u_U, u_V;
      varying vec2 v_uv;
      void main() {
        float y = texture2D(u_Y, v_uv).r;
        float u = texture2D(u_U, v_uv).r - 0.5;
        float v = texture2D(u_V, v_uv).r - 0.5;

        y = 1.164 * (y - 0.0625);
        float r = y + 1.596 * v;
        float g = y - 0.391 * u - 0.813 * v;
        float b = y + 2.018 * u;

        gl_FragColor = vec4(clamp(r, 0.0, 1.0),
                            clamp(g, 0.0, 1.0),
                            clamp(b, 0.0, 1.0), 1.0);
      }`;

    const mkShader = (t: number, s: string) => {
      const sh = gl.createShader(t)!;
      gl.shaderSource(sh, s); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(sh)!);
      return sh;
    };

    const prog = gl.createProgram()!;
    gl.attachShader(prog, mkShader(gl.VERTEX_SHADER,   VS));
    gl.attachShader(prog, mkShader(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(prog)!);
    gl.useProgram(prog);
    this._prog = prog;

    const vbuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
    gl.bufferData(gl.ARRAY_BUFFER,
      new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);

    const mkTex = (unit: number, name: string) => {
      const t = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S,     gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T,     gl.CLAMP_TO_EDGE);
      gl.uniform1i(gl.getUniformLocation(prog, name), unit);
      return t;
    };
    this._texY = mkTex(0, 'u_Y');
    this._texU = mkTex(1, 'u_U');
    this._texV = mkTex(2, 'u_V');

    this._glReady = true;
  }

  private _ensureGLAlloc(w: number, h: number): void {
    if (this._texW === w && this._texH === h) return;

    const gl  = this._gl;
    const gl2 = this._isGL2 ? gl as WebGL2RenderingContext : null;
    const cw  = w >> 1, ch = h >> 1;
    const ySize  = w * h;
    const uvSize = cw * ch;

    if (gl2) {
      const resetPBO = (existing: WebGLBuffer | null, size: number): WebGLBuffer => {
        const b = existing ?? gl2.createBuffer()!;
        gl2.bindBuffer(gl2.PIXEL_UNPACK_BUFFER, b);
        gl2.bufferData(gl2.PIXEL_UNPACK_BUFFER, size, gl2.DYNAMIC_DRAW);
        gl2.bindBuffer(gl2.PIXEL_UNPACK_BUFFER, null);
        return b;
      };
      this._pboY = resetPBO(this._pboY, ySize);
      this._pboU = resetPBO(this._pboU, uvSize);
      this._pboV = resetPBO(this._pboV, uvSize);

      const allocR8 = (tex: WebGLTexture, tw: number, th: number) => {
        gl2.bindTexture(gl2.TEXTURE_2D, tex);
        gl2.texImage2D(gl2.TEXTURE_2D, 0, gl2.R8, tw, th, 0, gl2.RED, gl2.UNSIGNED_BYTE, null);
      };
      allocR8(this._texY, w,  h);
      allocR8(this._texU, cw, ch);
      allocR8(this._texV, cw, ch);
    } else {
      const allocL = (tex: WebGLTexture, tw: number, th: number) => {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, tw, th, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, null);
      };
      allocL(this._texY, w,  h);
      allocL(this._texU, cw, ch);
      allocL(this._texV, cw, ch);
    }

    this._texW = w;
    this._texH = h;
  }

  private _drawYUV(y: Uint8Array, u: Uint8Array, v: Uint8Array, w: number, h: number): void {
    if (!this._glReady) return;
    this._ensureGLAlloc(w, h);

    const gl  = this._gl;
    const gl2 = this._isGL2 ? gl as WebGL2RenderingContext : null;
    const cw  = w >> 1, ch = h >> 1;
    const ySize  = w * h;
    const uvSize = cw * ch;

    const yView = y.byteLength === ySize  ? y : y.subarray(0, ySize);
    const uView = u.byteLength === uvSize ? u : u.subarray(0, uvSize);
    const vView = v.byteLength === uvSize ? v : v.subarray(0, uvSize);

    if (gl2 && this._pboY && this._pboU && this._pboV) {
      const up = (pbo: WebGLBuffer, tex: WebGLTexture, d: Uint8Array, tw: number, th: number, unit: number) => {
        gl2.activeTexture(gl2.TEXTURE0 + unit);
        gl2.bindTexture(gl2.TEXTURE_2D, tex);
        gl2.bindBuffer(gl2.PIXEL_UNPACK_BUFFER, pbo);
        gl2.bufferSubData(gl2.PIXEL_UNPACK_BUFFER, 0, d);
        gl2.texSubImage2D(gl2.TEXTURE_2D, 0, 0, 0, tw, th, gl2.RED, gl2.UNSIGNED_BYTE, 0);
        gl2.bindBuffer(gl2.PIXEL_UNPACK_BUFFER, null);
      };
      up(this._pboY, this._texY, yView, w,  h,  0);
      up(this._pboU, this._texU, uView, cw, ch, 1);
      up(this._pboV, this._texV, vView, cw, ch, 2);
    } else {
      const up = (tex: WebGLTexture, d: Uint8Array, tw: number, th: number, unit: number) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, tw, th, gl.LUMINANCE, gl.UNSIGNED_BYTE, d);
      };
      up(this._texY, yView, w,  h,  0);
      up(this._texU, uView, cw, ch, 1);
      up(this._texV, vView, cw, ch, 2);
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // ── DOM ───────────────────────────────────────────────────────────────────

  private _buildDOM(): void {
    const shadow = this.shadowRoot!;
    const style  = document.createElement('style');
    style.textContent = `
      :host  { display: inline-block; position: relative; }
      div.wrap { position: relative; width: 100%; height: 100%; overflow: hidden; }
      canvas { width: 100%; height: 100%; display: block; }`;

    this._canvas = document.createElement('canvas');
    this._canvas.width  = this._renderW;
    this._canvas.height = this._renderH;

    // <audio> vai para o LIGHT DOM (fora do shadow) em connectedCallback.
    // WebViews às vezes bloqueiam media policies em shadow DOM.
    this._audio = document.createElement('audio');
    this._audio.setAttribute('style', 'display:none;position:absolute;');
    this._audio.preload = 'auto';
    // NÃO usar crossOrigin aqui — src é blob, não há cross-origin.

    const gl2 = this._canvas.getContext('webgl2', { antialias: false }) as WebGL2RenderingContext | null;
    if (gl2) {
      this._gl = gl2; this._isGL2 = true;
    } else {
      const gl1 = this._canvas.getContext('webgl', { antialias: false }) as WebGLRenderingContext | null;
      if (!gl1) throw new Error('[FFmpegVideo] WebGL indisponível.');
      this._gl = gl1; this._isGL2 = false;
    }

    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.appendChild(this._canvas);
    shadow.appendChild(style);
    shadow.appendChild(wrap);
  }

  private _teardown(): void {
    if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
    if (this._audioRetry) { clearTimeout(this._audioRetry); this._audioRetry = null; }
    cancelAnimationFrame(this._rafId);
    this._rafId = 0;

    if (this._ws) {
      this._ws.onmessage = null; this._ws.onerror = null;
      this._ws.onclose   = null; this._ws.close();
      this._ws = null;
    }
    if (this._ctrlWs) {
      this._ctrlWs.onclose = null; this._ctrlWs.onerror = null;
      this._ctrlWs.close(); this._ctrlWs = null;
    }

    this._stopAudio();
    this._queue   = [];
    this._playing = false;
  }

  private _resolvePath(src: string): string {
    if (src.match(/^[A-Za-z]:[/\\]/) || src.startsWith('/')) return src;

    let p = src;
    if (p.startsWith('asset://')) {
      p = p.replace(/^asset:\/\/localhost\//, '').replace(/^asset:\/\//, '');
    } else if (p.startsWith('http://asset.localhost/') || p.startsWith('https://asset.localhost/')) {
      p = p.replace(/^https?:\/\/asset\.localhost\//, '');
    }
    p = decodeURIComponent(p);

    if (isWindows() || /^[A-Za-z][:/]/.test(p)) {
      p = p.replace(/\//g, '\\');
      if (!/^[A-Za-z]:\\/.test(p)) p = p.replace(/^\\/, '');
    }
    return p;
  }
}

customElements.define('ffmpeg-video', FFmpegVideo);