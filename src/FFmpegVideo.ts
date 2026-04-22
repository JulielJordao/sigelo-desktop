import { invoke } from '@tauri-apps/api/core';

// ─────────────────────────────────────────────────────────────────────────────
//  FFmpegVideo — Web Component (multi-instância)
//
//  v5 — Compatibilidade total com <video> API:
//    1. videoRef.play()  / .pause()  / .currentTime = t   → funciona idêntico
//    2. videoRef.muted / .volume / .playbackRate / .loop  → reatividade OK
//    3. Atributo preview-only → exibe só thumbnail (get_video_preview)
//    4. Atributo no-audio     → não carrega áudio
//    5. Áudio: <audio src="http://..."> direto (sem MSE). Se autoplay bloquear,
//       desbloqueia no 1º gesture. Funciona no Tauri v2 com CSP correto.
//    6. Eventos: play, pause, seeking, seeked, ended, timeupdate, loadedmetadata
// ─────────────────────────────────────────────────────────────────────────────

interface FrameMeta {
  pts:            number;
  duration:       number;
  video_width:    number;
  video_height:   number;
  fps:            number;
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
const uid = () =>
  `ffv${Date.now().toString(36)}${(++__seq).toString(36)}${(Math.random()*1e6|0).toString(36)}`;

function isWindows(): boolean {
  const d = (navigator as any).userAgentData;
  if (d?.platform) return /win/i.test(d.platform);
  return /Windows/i.test(navigator.userAgent);
}

// ── Gesture unlock global ──────────────────────────────────────────────────
let _gestureOk = false;
const _gestureQ: (() => void)[] = [];
function _onGesture() {
  if (_gestureOk) return;
  _gestureOk = true;
  _gestureQ.splice(0).forEach(f => f());
  for (const e of ['click','keydown','touchstart','pointerdown'])
    window.removeEventListener(e, _onGesture, true);
}
for (const e of ['click','keydown','touchstart','pointerdown'])
  window.addEventListener(e, _onGesture, true);
function waitGesture(): Promise<void> {
  return _gestureOk ? Promise.resolve() : new Promise(r => _gestureQ.push(r));
}

export class FFmpegVideo extends HTMLElement {

  // ── HTMLMediaElement-like API ─────────────────────────────────────────────
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
    if (this._playing) {
      this.seek(v).catch(() => {});
    } else {
      this._currentTime = v;
    }
  }

  private _rate = 1.0;
  private _fps  = 30;
  get playbackRate() { return this._rate; }
  set playbackRate(v: number) {
    this._rate = Math.max(0.25, Math.min(4.0, v));
    this._sendCmd({ cmd: 'set_rate', rate: this._rate });
  }

  get src()  { return this.getAttribute('src'); }
  set src(v) { v ? this.setAttribute('src', v) : this.removeAttribute('src'); }

  get muted() { return this.hasAttribute('muted'); }
  set muted(v: boolean) {
    v ? this.setAttribute('muted', '') : this.removeAttribute('muted');
    if (this._audio) this._audio.muted = v;
    if (v) this._stopAudio();
    else if (this._playing) this._connectAudio();
  }

  get loop() { return this.hasAttribute('loop'); }
  set loop(v: boolean) {
    v ? this.setAttribute('loop', '') : this.removeAttribute('loop');
    this._sendCmd({ cmd: 'set_loop', enabled: v });
  }

  get volume(): number { return parseFloat(this.getAttribute('volume') ?? '1'); }
  set volume(v: number) {
    const c = Math.max(0, Math.min(1, v));
    this.setAttribute('volume', String(c));
    if (this._audio) this._audio.volume = c;
  }

  /// Quando true, mostra apenas o preview (thumbnail) sem pipeline.
  get previewOnly(): boolean { return this.hasAttribute('preview-only'); }
  set previewOnly(v: boolean) { v ? this.setAttribute('preview-only','') : this.removeAttribute('preview-only'); }

  /// Quando true, não carrega áudio.
  get noAudio(): boolean { return this.hasAttribute('no-audio'); }
  set noAudio(v: boolean) { v ? this.setAttribute('no-audio','') : this.removeAttribute('no-audio'); }

  /// object-fit do canvas interno: 'contain' | 'cover' | 'fill' | 'none'
  get objectFit(): string { return this.getAttribute('object-fit') ?? 'contain'; }
  set objectFit(v: string) { this.setAttribute('object-fit', v); }

  // ── Privados ──────────────────────────────────────────────────────────────
  private readonly _sid = uid();
  private _canvas!: HTMLCanvasElement;
  private _audio!:  HTMLAudioElement;
  private _previewImg!: HTMLImageElement;

  private _gl!: WebGLRenderingContext | WebGL2RenderingContext;
  private _isGL2 = false;
  private _prog!: WebGLProgram;
  private _texY!: WebGLTexture;  private _texU!: WebGLTexture;  private _texV!: WebGLTexture;
  private _pboY: WebGLBuffer|null = null;
  private _pboU: WebGLBuffer|null = null;
  private _pboV: WebGLBuffer|null = null;
  private _glReady = false;
  private _texW = 0; private _texH = 0;

  private _ws: WebSocket|null = null;
  private _ctrlWs: WebSocket|null = null;

  private _queue: QueuedFrame[] = [];
  private _maxQueue = 12;
  private _wallStart = 0; private _ptsStart = 0;
  private _clockSeeded = false; private _rafId = 0;

  private _domOk   = false;
  private _playing = false;
  private _renderW = 1280;
  private _renderH = 720;
  private _firstFrame = true;
  private _retryTimer: ReturnType<typeof setTimeout>|null = null;
  private _audioRetry: ReturnType<typeof setTimeout>|null = null;
  private _hasRemoteAudio = false;
  private _styleObserver: MutationObserver|null = null;

  private get _tag() { return `[FFV ${this._sid.slice(-6)}]`; }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._buildDOM();
  }

  static get observedAttributes() {
    return ['src','width','height','autoplay','muted','loop','volume','playbackrate','preview-only','no-audio','object-fit'];
  }

  connectedCallback() {
    this._domOk = true;
    this._initGL();
    this._syncObjectFit();

    // Observa mudanças de style inline (ex: :style="{ objectFit: ... }" do Vue)
    this._styleObserver = new MutationObserver(() => this._syncObjectFit());
    this._styleObserver.observe(this, { attributes: true, attributeFilter: ['style'] });

    if (!this._audio.parentNode) this.appendChild(this._audio);
    this._audio.muted  = this.muted;
    this._audio.volume = this.volume;

    if (this.previewOnly && this.src) this._loadPreview();
    else if (this.hasAttribute('autoplay') && this.src) this.play();
  }

  disconnectedCallback() {
    this._domOk = false;
    if (this._styleObserver) { this._styleObserver.disconnect(); this._styleObserver = null; }
    this._teardown();
    if (this._audio.parentNode) this._audio.parentNode.removeChild(this._audio);
    invoke('stop_video', { sessionId: this._sid }).catch(() => {});
  }

  attributeChangedCallback(name: string, prev: string|null, val: string|null) {
    if (prev === val) return;
    switch (name) {
      case 'width':        if (val) { this._renderW = +val; this._canvas.width  = this._renderW; this._lastObjectFit=''; this._syncObjectFit(); } break;
      case 'height':       if (val) { this._renderH = +val; this._canvas.height = this._renderH; this._lastObjectFit=''; this._syncObjectFit(); } break;
      case 'volume':       if (this._audio) this._audio.volume = this.volume; break;
      case 'muted':        if (this._audio) this._audio.muted  = this.muted;  break;
      case 'playbackrate': if (val) this.playbackRate = +val; break;
      case 'object-fit':   this._syncObjectFit(); break;
      case 'preview-only':
        if (this._domOk && this.previewOnly && this.src) this._loadPreview();
        break;
      case 'src':
        if (!val || !this._domOk) break;
        if (this.previewOnly) this._loadPreview();
        else if (this._playing) this.play();
        break;
    }
  }

  // ── play() — comportamento idêntico ao <video> nativo ───────────────────
  // - Se nunca iniciou: inicia do zero (ou do currentTime se já foi setado)
  // - Se está pausado:  despausa (resume) SEM reiniciar pipeline
  // - Se já está tocando: no-op

  async play(): Promise<void> {
    // CASO 1: já tocando → no-op (igual ao <video> nativo)
    if (this._playing && !this.paused) return;

    // CASO 2: pausado → só despausa, não reinicia
    if (this._playing && this.paused) {
      this.resume();
      return;
    }

    // CASO 3: primeira execução ou após ended → inicia pipeline
    const src = this.src;
    if (!src) return;

    this._previewImg.style.display = 'none';
    this._canvas.style.display     = 'block';

    this._teardown();
    this._playing     = true;
    this.paused       = false;
    this.ended        = false;
    this._firstFrame  = true;
    this._clockSeeded = false;
    this._queue       = [];

    // Preserva currentTime se foi setado antes de play() (ex: seek antes de iniciar)
    const startSeek = this._currentTime > 0 ? this._currentTime : 0;

    const w      = this._renderW;
    const h      = this._renderH;
    const loop_  = this.loop;
    const path   = this._resolvePath(src);
    const skipAudio = this.noAudio || this.muted;

    try {
      await invoke('play_video', {
        sessionId: this._sid,
        path, width: w, height: h,
        noAudio:   skipAudio,
        loopVideo: loop_,
      });
    } catch (e) {
      console.error(`${this._tag} play_video falhou:`, e);
      this._playing = false;
      this.paused   = true;
      return;
    }

    // Se havia um currentTime pré-definido, faz seek imediato
    if (startSeek > 0) {
      try {
        await invoke('send_video_command', {
          sessionId: this._sid,
          command: { cmd: 'seek', time: startSeek },
        });
      } catch {}
    }

    this.dispatchEvent(new Event('play', { bubbles: true, composed: true }));
    this.dispatchEvent(new Event('playing', { bubbles: true, composed: true }));

    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      if (!this._playing) return;
      this._connectVideoWS();
      this._connectCtrlWS();
      if (!skipAudio) this._connectAudio();
    }, 500);
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this._sendCmd({ cmd: 'pause' });
    if (this._audio) this._audio.pause();
    this.dispatchEvent(new Event('pause', { bubbles: true, composed: true }));
  }

  resume(): void {
    if (!this.paused || !this._playing) return;
    this.paused = false;
    this._sendCmd({ cmd: 'play' });
    if (this._clockSeeded && this._queue.length > 0) {
      this._wallStart = performance.now();
      this._ptsStart  = this._queue[0].pts;
    }
    if (this._audio) this._audio.play().catch(() => {});
    this.dispatchEvent(new Event('play', { bubbles: true, composed: true }));
  }

  async seek(time: number): Promise<void> {
    this.dispatchEvent(new Event('seeking', { bubbles: true, composed: true }));
    this._currentTime = time;
    this._queue       = [];
    this._firstFrame  = true;
    this._clockSeeded = false;

    try {
      await invoke('send_video_command', {
        sessionId: this._sid,
        command:   { cmd: 'seek', time },
      });
    } catch (e) {
      console.warn(`${this._tag} seek:`, e);
      this._sendCmd({ cmd: 'seek', time });
    }

    // Reconecta áudio — sempre tenta se não está mutado
    this._stopAudio();
    if (!this.noAudio && !this.muted) {
      if (this._audioRetry) clearTimeout(this._audioRetry);
      this._audioRetry = setTimeout(() => {
        this._audioRetry = null;
        this._connectAudio();
      }, 400);
    }
    this.dispatchEvent(new Event('seeked', { bubbles: true, composed: true }));
  }

  // ── Preview mode ──────────────────────────────────────────────────────────

  private async _loadPreview(): Promise<void> {
    const src = this.src;
    if (!src) return;
    this._teardown();
    try {
      const path = this._resolvePath(src);
      const bytes: number[] = await invoke('get_video_preview', {
        path,
        timestamp: this._currentTime || 0,
        width:  this._renderW  || undefined,
        height: this._renderH || undefined,
      });
      const u8  = new Uint8Array(bytes);
      const blob = new Blob([u8], { type: 'image/jpeg' });
      const url  = URL.createObjectURL(blob);

      this._previewImg.onload = () => URL.revokeObjectURL(url);
      this._previewImg.src            = url;
      this._previewImg.style.display  = 'block';
      this._canvas.style.display      = 'none';
    } catch (e) {
      console.warn(`${this._tag} preview:`, e);
    }
  }

  // ── WebSocket vídeo ───────────────────────────────────────────────────────

  private _connectVideoWS(retries = 12): void {
    if (!this._playing) return;
    const ws = new WebSocket(`ws://127.0.0.1:9001/${this._sid}`);
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
      if (retries > 0)
        this._retryTimer = setTimeout(() => {
          this._retryTimer = null;
          this._connectVideoWS(retries - 1);
        }, 350);
      else {
        this._playing = false;
        this.paused   = true;
        this.dispatchEvent(new Event('error'));
      }
    };
  }

  private _connectCtrlWS(retries = 5): void {
    if (!this._playing) return;
    const ws = new WebSocket(`ws://127.0.0.1:9003/${this._sid}`);
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

  // ── Áudio via <audio src="http://..."> direto ─────────────────────────────
  //
  //  ESTRATÉGIA SIMPLES (v5):
  //  Ao invés de MediaSource que falha silenciosamente em vários WebViews,
  //  usamos <audio src="http://127.0.0.1:9002/{sid}/stream.mp4"> direto.
  //
  //  Requer no CSP:
  //    connect-src ... ws://127.0.0.1:* http://127.0.0.1:*;
  //    media-src   ... http://127.0.0.1:*;
  //
  //  Se autoplay for bloqueado (NotAllowedError), aguarda gesture e tenta
  //  novamente. O <audio> está no LIGHT DOM para evitar policy quirks de
  //  shadow DOM.
  //

  private _audioFallbackTimer: ReturnType<typeof setTimeout> | null = null;

  private _connectAudio(): void {
    if (!this._playing || this.muted || this.noAudio) return;

    const url = `http://127.0.0.1:9002/${this._sid}/stream.mp4?t=${Date.now()}`;
    console.log(`${this._tag} audio →`, url);

    this._audio.src    = url;
    this._audio.volume = this.volume;
    this._audio.muted  = false;
    this._audio.load();

    const tryPlay = () => {
      const p = this._audio.play();
      if (!p || typeof p.then !== 'function') return;
      p.then(() => {
        console.log(`${this._tag} ✔ audio playing`);
        this._hasRemoteAudio = true;
      }).catch(err => {
        console.warn(`${this._tag} autoplay bloqueado (${err.name}) → aguardando gesture`);
        waitGesture().then(() => {
          if (!this._playing || this.muted) return;
          this._audio.play()
            .then(() => { console.log(`${this._tag} ✔ audio após gesture`); this._hasRemoteAudio = true; })
            .catch(e2 => console.warn(`${this._tag} ✘ audio após gesture:`, e2));
        });
      });
    };

    this._audio.oncanplay = () => {
      this._audio.oncanplay = null;
      if (this._audioFallbackTimer) { clearTimeout(this._audioFallbackTimer); this._audioFallbackTimer = null; }
      tryPlay();
    };

    // Fallback: se canplay nunca disparar em 3s, tenta mesmo assim
    if (this._audioFallbackTimer) clearTimeout(this._audioFallbackTimer);
    this._audioFallbackTimer = setTimeout(() => {
      this._audioFallbackTimer = null;
      if (!this._playing || this._audio.readyState >= 2) return;
      console.log(`${this._tag} audio: fallback play sem canplay (readyState=${this._audio.readyState})`);
      tryPlay();
    }, 3000);

    this._audio.onerror = () => {
      if (this._audioFallbackTimer) { clearTimeout(this._audioFallbackTimer); this._audioFallbackTimer = null; }
      const e = this._audio.error;
      console.warn(`${this._tag} ✘ <audio> error code=${e?.code} msg=${e?.message}`);
    };
  }

  private _stopAudio(): void {
    if (this._audioRetry) { clearTimeout(this._audioRetry); this._audioRetry = null; }
    if (this._audioFallbackTimer) { clearTimeout(this._audioFallbackTimer); this._audioFallbackTimer = null; }
    if (!this._audio) return;
    this._audio.oncanplay = null;
    this._audio.onerror   = null;
    this._audio.pause();
    this._audio.removeAttribute('src');
    this._audio.load();
    this._hasRemoteAudio = false;
  }

  // ── Queue ─────────────────────────────────────────────────────────────────

  private _enqueue(data: Uint8Array): void {
    const sep = data.indexOf(0x7C);
    if (sep === -1) return;

    let meta: FrameMeta;
    try { meta = JSON.parse(new TextDecoder().decode(data.subarray(0, sep))); }
    catch { return; }

    const rw = meta.video_width | 0;
    const rh = meta.video_height | 0;
    if (rw <= 0 || rh <= 0 || (rw & 1) || (rh & 1)) return;

    const cw = rw >> 1, ch = rh >> 1;
    const ySize = rw * rh, uvSize = cw * ch;
    const pixels = data.subarray(sep + 1);
    if (pixels.byteLength < ySize + uvSize * 2) return;

    const y = pixels.subarray(0,              ySize);
    const u = pixels.subarray(ySize,          ySize + uvSize);
    const v = pixels.subarray(ySize + uvSize, ySize + uvSize * 2);

    if (this._firstFrame) {
      this.duration    = meta.duration;
      this.videoWidth  = meta.video_width;
      this.videoHeight = meta.video_height;
      this._fps        = meta.fps > 0 ? meta.fps : 30;
      this.readyState  = 4;
      // Aplica object-fit agora que conhecemos as dimensões reais do vídeo
      this._lastObjectFit = ''; // força reaplicação
      this._syncObjectFit();
      // bubbles:true + composed:true → atravessa shadow DOM → Vue @loadedmetadata funciona
      this.dispatchEvent(new Event('loadedmetadata', { bubbles: true, composed: true }));
      this.dispatchEvent(new Event('canplaythrough',  { bubbles: true, composed: true }));
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
      if (this.paused || !this._clockSeeded || !this._queue.length) return;

      const elapsed   = (now - this._wallStart) / 1000;
      const targetPts = this._ptsStart + elapsed * this._rate;
      const tol       = 0.5 / Math.max(this._fps, 1);

      while (this._queue.length > 1 && this._queue[0].pts < targetPts - tol)
        this._queue.shift();

      const frame = this._queue[0];
      if (!frame || frame.pts > targetPts + 2 / this._fps) return;

      this._queue.shift();
      this._currentTime = frame.pts;
      this.dispatchEvent(new CustomEvent('timeupdate', {
        bubbles: true, composed: true,
        detail: { currentTime: this._currentTime },
      }));

      this._drawYUV(frame.y, frame.u, frame.v, frame.w, frame.h);

      if (!this.loop && this.duration > 0
          && this._currentTime >= this.duration - 1 / this._fps
          && !this._queue.length) {
        this.ended = true; this.paused = true; this._playing = false;
        this.dispatchEvent(new Event('ended', { bubbles: true, composed: true }));
      }
    };
    this._rafId = requestAnimationFrame(tick);
  }

  // ── WebGL ─────────────────────────────────────────────────────────────────

  private _initGL(): void {
    const gl = this._gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    const VS = `
      attribute vec2 a_pos; varying vec2 v_uv;
      void main() {
        gl_Position = vec4(a_pos, 0.0, 1.0);
        v_uv = vec2((a_pos.x+1.0)*0.5, 1.0-(a_pos.y+1.0)*0.5);
      }`;

    const FS = `
      precision mediump float;
      uniform sampler2D u_Y, u_U, u_V; varying vec2 v_uv;
      void main() {
        float y = texture2D(u_Y, v_uv).r;
        float u = texture2D(u_U, v_uv).r - 0.5;
        float v = texture2D(u_V, v_uv).r - 0.5;
        y = 1.164 * (y - 0.0625);
        gl_FragColor = vec4(
          clamp(y + 1.596*v, 0.,1.),
          clamp(y - 0.391*u - 0.813*v, 0.,1.),
          clamp(y + 2.018*u, 0.,1.), 1.0);
      }`;

    const mkS = (t: number, s: string) => {
      const sh = gl.createShader(t)!;
      gl.shaderSource(sh, s); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)!);
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, mkS(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, mkS(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog)!);
    gl.useProgram(prog); this._prog = prog;

    const vb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);

    const mkT = (u: number, n: string) => {
      const t = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + u);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(gl.getUniformLocation(prog, n), u);
      return t;
    };
    this._texY = mkT(0,'u_Y'); this._texU = mkT(1,'u_U'); this._texV = mkT(2,'u_V');
    this._glReady = true;
  }

  private _ensureGLAlloc(w: number, h: number): void {
    if (this._texW === w && this._texH === h) return;
    const gl = this._gl, gl2 = this._isGL2 ? gl as WebGL2RenderingContext : null;
    const cw = w>>1, ch = h>>1;
    if (gl2) {
      const rPBO = (b: WebGLBuffer|null, sz: number) => {
        const buf = b ?? gl2.createBuffer()!;
        gl2.bindBuffer(gl2.PIXEL_UNPACK_BUFFER, buf);
        gl2.bufferData(gl2.PIXEL_UNPACK_BUFFER, sz, gl2.DYNAMIC_DRAW);
        gl2.bindBuffer(gl2.PIXEL_UNPACK_BUFFER, null);
        return buf;
      };
      this._pboY = rPBO(this._pboY, w*h);
      this._pboU = rPBO(this._pboU, cw*ch);
      this._pboV = rPBO(this._pboV, cw*ch);
      const aR8 = (t: WebGLTexture, tw: number, th: number) => {
        gl2.bindTexture(gl2.TEXTURE_2D, t);
        gl2.texImage2D(gl2.TEXTURE_2D, 0, gl2.R8, tw, th, 0, gl2.RED, gl2.UNSIGNED_BYTE, null);
      };
      aR8(this._texY, w, h); aR8(this._texU, cw, ch); aR8(this._texV, cw, ch);
    } else {
      const aL = (t: WebGLTexture, tw: number, th: number) => {
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, tw, th, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, null);
      };
      aL(this._texY, w, h); aL(this._texU, cw, ch); aL(this._texV, cw, ch);
    }
    this._texW = w; this._texH = h;
  }

  private _drawYUV(y: Uint8Array, u: Uint8Array, v: Uint8Array, w: number, h: number): void {
    if (!this._glReady) return;
    this._ensureGLAlloc(w, h);
    const gl = this._gl, gl2 = this._isGL2 ? gl as WebGL2RenderingContext : null;
    const cw = w>>1, ch = h>>1, yS = w*h, uvS = cw*ch;
    const yV = y.byteLength===yS ? y : y.subarray(0,yS);
    const uV = u.byteLength===uvS ? u : u.subarray(0,uvS);
    const vV = v.byteLength===uvS ? v : v.subarray(0,uvS);

    // 1. Limpa canvas inteiro com preto (cobre letterbox/pillarbox de contain)
    const canvasW = this._canvas.width, canvasH = this._canvas.height;
    gl.viewport(0, 0, canvasW, canvasH);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // 2. Aplica viewport do object-fit atual para o draw do frame
    this._applyObjectFitToGL(this._lastObjectFit || 'contain');

    if (gl2 && this._pboY && this._pboU && this._pboV) {
      const up = (p: WebGLBuffer, t: WebGLTexture, d: Uint8Array, tw: number, th: number, i: number) => {
        gl2.activeTexture(gl2.TEXTURE0+i); gl2.bindTexture(gl2.TEXTURE_2D, t);
        gl2.bindBuffer(gl2.PIXEL_UNPACK_BUFFER, p);
        gl2.bufferSubData(gl2.PIXEL_UNPACK_BUFFER, 0, d);
        gl2.texSubImage2D(gl2.TEXTURE_2D, 0, 0, 0, tw, th, gl2.RED, gl2.UNSIGNED_BYTE, 0);
        gl2.bindBuffer(gl2.PIXEL_UNPACK_BUFFER, null);
      };
      up(this._pboY,this._texY,yV,w,h,0);
      up(this._pboU,this._texU,uV,cw,ch,1);
      up(this._pboV,this._texV,vV,cw,ch,2);
    } else {
      const up = (t: WebGLTexture, d: Uint8Array, tw: number, th: number, i: number) => {
        gl.activeTexture(gl.TEXTURE0+i); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, tw, th, gl.LUMINANCE, gl.UNSIGNED_BYTE, d);
      };
      up(this._texY,yV,w,h,0); up(this._texU,uV,cw,ch,1); up(this._texV,vV,cw,ch,2);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // ── DOM ───────────────────────────────────────────────────────────────────

  private _buildDOM(): void {
    const shadow = this.shadowRoot!;
    shadow.innerHTML = `<style>
      :host {
        display: inline-block;
        position: relative;
        /* Propaga object-fit do host para o canvas via CSS var */
        --ffv-object-fit: contain;
      }
      .wrap { position: relative; width: 100%; height: 100%; overflow: hidden; }
      canvas, img {
        width: 100%; height: 100%; display: block;
        object-fit: var(--ffv-object-fit);
      }
      audio { display: none; }
    </style><div class="wrap"><canvas></canvas><img style="display:none"/></div>`;

    this._canvas     = shadow.querySelector('canvas')!;
    this._previewImg = shadow.querySelector('img')!;
    this._canvas.width  = this._renderW;
    this._canvas.height = this._renderH;

    // <audio> no LIGHT DOM — WebViews aplicam media policy melhor fora do shadow
    this._audio = document.createElement('audio');
    this._audio.setAttribute('style', 'display:none;position:absolute;');
    this._audio.preload = 'auto';

    const gl2 = this._canvas.getContext('webgl2', { antialias:false }) as WebGL2RenderingContext|null;
    if (gl2) { this._gl = gl2; this._isGL2 = true; }
    else {
      const gl1 = this._canvas.getContext('webgl', { antialias:false }) as WebGLRenderingContext|null;
      if (!gl1) throw new Error('WebGL indisponível');
      this._gl = gl1; this._isGL2 = false;
    }
  }

  private _lastObjectFit = '';

  private _syncObjectFit(): void {
    // Lê em ordem de prioridade sem causar loop:
    // 1. atributo `object-fit` explícito no elemento
    // 2. style inline `objectFit` (Vue :style="{ objectFit: 'cover' }")
    // 3. computed style (CSS class)
    const attr     = this.getAttribute('object-fit');
    const inline   = this.style.objectFit;
    const computed = getComputedStyle(this).objectFit;
    const fit      = attr || inline || computed || 'contain';

    if (fit === this._lastObjectFit) return;
    this._lastObjectFit = fit;

    // CSS var → lida pelo <img> de preview (que entende object-fit nativo)
    // O MutationObserver não re-dispara para CSS vars (--), só para propriedades normais
    this.style.setProperty('--ffv-object-fit', fit);

    // WebGL: object-fit não funciona em canvas — precisa ajustar via viewport
    this._applyObjectFitToGL(fit);
  }

  /// Aplica object-fit no canvas WebGL ajustando o viewport.
  /// contain → letterbox/pillarbox  (padrão)
  /// cover   → crop centralizado
  /// fill    → estica para preencher (padrão do WebGL — sem ajuste)
  /// none    → tamanho natural do vídeo centralizado
  private _applyObjectFitToGL(fit: string): void {
    if (!this._glReady) return;
    const gl = this._gl;

    // Dimensões do canvas (display)
    const cw = this._canvas.width;
    const ch = this._canvas.height;
    // Dimensões do vídeo (fonte)
    const vw = this.videoWidth  || cw;
    const vh = this.videoHeight || ch;

    if (fit === 'fill' || vw === 0 || vh === 0) {
      // fill: WebGL já preenche tudo por padrão
      gl.viewport(0, 0, cw, ch);
      return;
    }

    const canvasRatio = cw / ch;
    const videoRatio  = vw / vh;

    let vpW: number, vpH: number, vpX: number, vpY: number;

    if (fit === 'cover') {
      // Escala para cobrir todo o canvas, corta o excesso
      if (canvasRatio > videoRatio) {
        vpW = cw;
        vpH = Math.round(cw / videoRatio);
      } else {
        vpH = ch;
        vpW = Math.round(ch * videoRatio);
      }
      vpX = Math.round((cw - vpW) / 2);
      vpY = Math.round((ch - vpH) / 2);
    } else if (fit === 'none') {
      // Tamanho natural, centralizado
      vpW = vw;
      vpH = vh;
      vpX = Math.round((cw - vw) / 2);
      vpY = Math.round((ch - vh) / 2);
    } else {
      // contain (padrão): cabe inteiro, com letterbox/pillarbox
      if (canvasRatio > videoRatio) {
        vpH = ch;
        vpW = Math.round(ch * videoRatio);
      } else {
        vpW = cw;
        vpH = Math.round(cw / videoRatio);
      }
      vpX = Math.round((cw - vpW) / 2);
      vpY = Math.round((ch - vpH) / 2);
    }

    gl.viewport(vpX, vpY, vpW, vpH);
  }

  private _teardown(): void {
    if (this._retryTimer)         { clearTimeout(this._retryTimer); this._retryTimer = null; }
    if (this._audioRetry)         { clearTimeout(this._audioRetry); this._audioRetry = null; }
    if (this._audioFallbackTimer) { clearTimeout(this._audioFallbackTimer); this._audioFallbackTimer = null; }
    cancelAnimationFrame(this._rafId); this._rafId = 0;
    if (this._ws)     { this._ws.onmessage=null; this._ws.onerror=null; this._ws.onclose=null; this._ws.close(); this._ws=null; }
    if (this._ctrlWs) { this._ctrlWs.onclose=null; this._ctrlWs.onerror=null; this._ctrlWs.close(); this._ctrlWs=null; }
    this._stopAudio();
    this._queue = []; this._playing = false;
  }

  private _resolvePath(src: string): string {
    if (src.match(/^[A-Za-z]:[/\\]/) || src.startsWith('/')) return src;
    let p = src;
    if (p.startsWith('asset://')) p = p.replace(/^asset:\/\/localhost\//, '').replace(/^asset:\/\//, '');
    else if (p.startsWith('http://asset.localhost/') || p.startsWith('https://asset.localhost/'))
      p = p.replace(/^https?:\/\/asset\.localhost\//, '');
    p = decodeURIComponent(p);
    if (isWindows() || /^[A-Za-z][:/]/.test(p)) {
      p = p.replace(/\//g, '\\');
      if (!/^[A-Za-z]:\\/.test(p)) p = p.replace(/^\\/, '');
    }
    return p;
  }
}

// Guard: evita NotSupportedError se o módulo for carregado mais de uma vez
// (acontece com Vite HMR ou imports duplicados)
if (!customElements.get('ffmpeg-video')) {
  customElements.define('ffmpeg-video', FFmpegVideo);
}