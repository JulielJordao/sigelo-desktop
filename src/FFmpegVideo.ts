import { invoke } from '@tauri-apps/api/core';

// ─────────────────────────────────────────────────────────────────────────────
//  FFmpegVideo — Web Component
//  Wire (WS 9001):  [JSON UTF-8] 0x7C [YUV420P bytes]
//  YUV420P:  Y(w×h) + U(w/2×h/2) + V(w/2×h/2) — 3 planos separados
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
  pts:  number;
  y:    Uint8Array;
  u:    Uint8Array;
  v:    Uint8Array;
  _buf: Uint8Array;   // mantém o ArrayBuffer pai vivo (sem cópia)
}

export class FFmpegVideo extends HTMLElement {

  // ── HTMLMediaElement-like API ─────────────────────────────────────────────
  public currentTime = 0;
  public duration    = 0;
  public paused      = true;
  public ended       = false;
  public readyState  = 0;
  public videoWidth  = 0;
  public videoHeight = 0;

  private _rate = 1.0;
  private _fps  = 30;

  get playbackRate()    { return this._rate; }
  set playbackRate(v: number) {
    this._rate = Math.max(0.25, Math.min(4.0, v));
    this._sendCmd({ cmd: 'set_rate', rate: this._rate });
  }

  // ── WebGL ─────────────────────────────────────────────────────────────────
  private _canvas!: HTMLCanvasElement;
  private _audio!:  HTMLAudioElement;

  // Contexto GL criado UMA VEZ no construtor — nunca recriar no mesmo canvas
  private _gl!:   WebGLRenderingContext | WebGL2RenderingContext;
  private _isGL2  = false;

  private _prog!: WebGLProgram;
  private _texY!: WebGLTexture;
  private _texU!: WebGLTexture;
  private _texV!: WebGLTexture;

  private _pboY: WebGLBuffer | null = null;
  private _pboU: WebGLBuffer | null = null;
  private _pboV: WebGLBuffer | null = null;

  private _glReady = false;
  private _glAlloc = false;

  // ── WebSockets ────────────────────────────────────────────────────────────
  private _ws:     WebSocket | null = null;
  private _ctrlWs: WebSocket | null = null;

  // ── Frame queue ───────────────────────────────────────────────────────────
  private _queue:    QueuedFrame[] = [];
  private _maxQueue  = 6;

  // ── Clock A/V ─────────────────────────────────────────────────────────────
  private _wallStart   = 0;
  private _ptsStart    = 0;
  private _clockSeeded = false;
  private _rafId       = 0;

  // ── Estado ────────────────────────────────────────────────────────────────
  private _domConnected = false;
  private _playing      = false;
  private _renderW      = 1920;
  private _renderH      = 1080;
  private _firstFrame   = true;
  private _retryTimer:  ReturnType<typeof setTimeout> | null = null;
  private _renderAudio  = false;

  // ─────────────────────────────────────────────────────────────────────────
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._buildDOM();   // cria canvas + contexto GL aqui — UMA VEZ
  }

  static get observedAttributes() {
    return ['src', 'width', 'height', 'autoplay', 'muted', 'loop', 'volume', 'playbackrate'];
  }

  connectedCallback() {
    this._domConnected = true;
    this._initGL();
    this._audio.muted  = this.muted;
    this._audio.volume = this.volume;
    if (this.hasAttribute('autoplay') && this.src) this.play();
  }

  disconnectedCallback() {
    this._domConnected = false;
    this._teardown();
  }

  attributeChangedCallback(name: string, prev: string | null, val: string | null) {
    if (prev === val) return;
    switch (name) {
      case 'width':
        if (val) { this._renderW = +val; this._canvas.width  = this._renderW; this._glAlloc = false; }
        break;
      case 'height':
        if (val) { this._renderH = +val; this._canvas.height = this._renderH; this._glAlloc = false; }
        break;
      case 'volume':       this._audio.volume = this.volume; break;
      case 'muted':        this._audio.muted  = this.muted;  break;
      case 'playbackrate': if (val) this.playbackRate = +val; break;
      case 'src':          if (val && this._domConnected && this._playing) this.play(); break;
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  get src()  { return this.getAttribute('src'); }
  set src(v) { v ? this.setAttribute('src', v) : this.removeAttribute('src'); }

  get muted() { return this.hasAttribute('muted'); }
  set muted(v: boolean) {
    v ? this.setAttribute('muted', '') : this.removeAttribute('muted');
    this._audio.muted = v;
    this._sendCmd({ cmd: 'set_muted', muted: v });
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
    this._sendCmd({ cmd: 'set_volume', volume: c });
  }

  // ── play() ─────────────────────────────────────────────────────────────────

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
    this._glAlloc     = false;

    const w     = this._renderW;
    const h     = this._renderH;
    const audio = !this.muted;
    const loop  = this.loop;
    const path  = this._resolvePath(src);

    this._renderAudio = audio;

    try {
      await invoke('play_video', {
        path, width: w, height: h, renderAudio: audio, loopVideo: loop,
      });
    } catch (e) {
      console.error('[FFmpegVideo] play_video falhou:', e);
      this._playing = false;
      this.paused   = true;
      return;
    }

    this.dispatchEvent(new Event('play'));
    this.dispatchEvent(new Event('playing'));

    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      if (!this._playing) return;
      this._connectVideoWS(w, h);
      this._connectCtrlWS();
      if (audio) this._connectAudio();
    }, 400);
  }

  // ── pause() ────────────────────────────────────────────────────────────────
  //
  //  CORREÇÃO: pause() agora faz duas coisas:
  //  1. Envia { cmd: 'pause' } via WS de controle → Rust para o loop de frames
  //  2. Pausa o <audio> localmente para sincronizar A/V
  //
  //  NÃO fecha o WebSocket de vídeo — mantém a conexão para que resume() funcione
  //  sem precisar reconectar.
  //
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this._sendCmd({ cmd: 'pause' });
    this._audio.pause();
    this.dispatchEvent(new Event('pause'));
  }

  // ── resume() ───────────────────────────────────────────────────────────────
  resume(): void {
    if (!this.paused || !this._playing) return;
    this.paused = false;
    this._sendCmd({ cmd: 'play' });

    // Recalibra o clock para não consumir frames acumulados durante a pausa
    if (this._clockSeeded && this._queue.length > 0) {
      this._wallStart = performance.now();
      this._ptsStart  = this._queue[0].pts;
    }

    // Retoma o áudio no ponto certo
    this._audio.play().catch(() => {});
    this.dispatchEvent(new Event('play'));
  }

  // ── seek() ─────────────────────────────────────────────────────────────────
  //
  //  CORREÇÃO: seek() reinicia o pipeline do Rust com o novo offset.
  //  Em seguida reconecta o áudio apontando para o novo offset via
  //  AUDIO_SEEK_OFFSET (setado no Rust pelo WS de controle).
  //
  async seek(time: number): Promise<void> {
    this.dispatchEvent(new Event('seeking'));

    this.currentTime  = time;
    this._queue       = [];
    this._firstFrame  = true;
    this._clockSeeded = false;
    this._glAlloc     = false;

    // Envia seek para o Rust via invoke (reinicia o pipeline com novo -ss)
    try {
      await invoke('send_video_command', {
        command: { cmd: 'seek', time },
      });
    } catch (e) {
      console.warn('[FFmpegVideo] seek invoke falhou, tentando via WS:', e);
      this._sendCmd({ cmd: 'seek', time });
    }

    // Reconecta o áudio após seek (precisa de novo request HTTP com novo offset)
    this._stopAudio();
    if (this._renderAudio && !this.muted) {
      // Pequeno delay para o Rust atualizar AUDIO_SEEK_OFFSET antes do fetch
      setTimeout(() => this._connectAudio(), 300);
    }

    this.dispatchEvent(new Event('seeked'));
  }

  // ── WebSocket vídeo (9001) ─────────────────────────────────────────────────

  private _connectVideoWS(w: number, h: number, retries = 8): void {
    if (!this._playing) return;

    const ws = new WebSocket('ws://127.0.0.1:9001');
    ws.binaryType = 'arraybuffer';
    this._ws = ws;

    ws.onopen = () => {
      console.log('[FFmpegVideo] WS vídeo conectado');
      this._startRenderLoop();
    };

    ws.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
      if (!this._playing || this.paused) return;
      this._enqueue(new Uint8Array(data), w, h);
    };

    ws.onerror = () => {};

    ws.onclose = () => {
      if (!this._playing) return;
      if (retries > 0) {
        this._retryTimer = setTimeout(() => {
          this._retryTimer = null;
          this._connectVideoWS(w, h, retries - 1);
        }, 400);
      } else {
        this._playing = false;
        this.paused   = true;
        this.dispatchEvent(new Event('error'));
      }
    };
  }

  // ── WebSocket controle (9003) ──────────────────────────────────────────────

  private _connectCtrlWS(retries = 5): void {
    if (!this._playing) return;
    const ws = new WebSocket('ws://127.0.0.1:9003');
    this._ctrlWs = ws;
    ws.onopen  = () => console.log('[FFmpegVideo] WS ctrl conectado');
    ws.onclose = () => {
      this._ctrlWs = null;
      if (this._playing && retries > 0)
        setTimeout(() => this._connectCtrlWS(retries - 1), 500);
    };
    ws.onerror = () => {};
  }

  private _sendCmd(cmd: object): void {
    if (this._ctrlWs?.readyState === WebSocket.OPEN)
      this._ctrlWs.send(JSON.stringify(cmd));
  }

  // ── Áudio (HTTP 9002) ──────────────────────────────────────────────────────
  //
  //  CORREÇÃO "SEM ÁUDIO":
  //  1. fetch HEAD verifica se o servidor já está pronto antes de setar src
  //  2. Cache-buster (?t=) força novo request a cada play/seek
  //  3. crossOrigin = 'anonymous' para evitar bloqueio CORS no WebView
  //  4. Sem autoplay bloqueado: play() é chamado só depois de src ser setado
  //

  private _connectAudio(retries = 10): void {
    if (!this._playing || this.muted) return;

    const url = `http://127.0.0.1:9002/stream.aac?t=${Date.now()}`;

    fetch(url, { method: 'HEAD' })
      .then(res => {
        // Aceita qualquer 2xx ou mesmo 404 — o que importa é que o servidor respondeu
        if (!this._playing || this.muted) return;

        this._audio.src    = url;
        this._audio.volume = this.volume;
        this._audio.muted  = false;

        // oncanplay garante que o buffer mínimo foi recebido antes de dar play
        this._audio.oncanplay = () => {
          this._audio.oncanplay = null;
          this._audio.play().catch(e =>
            console.warn('[FFmpegVideo] Audio autoplay bloqueado:', e));
        };

        // Força o carregamento do novo src
        this._audio.load();
      })
      .catch(() => {
        if (this._playing && !this.muted && retries > 0)
          setTimeout(() => this._connectAudio(retries - 1), 200);
      });
  }

  private _stopAudio(): void {
    this._audio.oncanplay = null;
    this._audio.pause();
    this._audio.removeAttribute('src');
    this._audio.load();
  }

  // ── Fila de frames ─────────────────────────────────────────────────────────

  private _enqueue(data: Uint8Array, w: number, h: number): void {
    const sep = data.indexOf(0x7C);
    if (sep === -1) return;

    let meta: FrameMeta;
    try {
      meta = JSON.parse(new TextDecoder().decode(data.subarray(0, sep)));
    } catch { return; }

    const pixels = data.subarray(sep + 1);
    const ySize  = w * h;
    const uvSize = (w >> 1) * (h >> 1);
    if (pixels.byteLength < ySize + uvSize * 2) return;

    // subarray = view sem cópia (sem GC pressure)
    const y = pixels.subarray(0,             ySize);
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

    // Recalibra clock no reinício do loop
    if (meta.loop_restart) {
      this._wallStart   = performance.now();
      this._ptsStart    = meta.pts;
      this._clockSeeded = true;
    }

    if (this._queue.length >= this._maxQueue) this._queue.shift();
    this._queue.push({ pts: meta.pts, y, u, v, _buf: data });

    if (this._firstFrame) {
      this._firstFrame  = false;
      this._wallStart   = performance.now();
      this._ptsStart    = meta.pts;
      this._clockSeeded = true;
    }
  }

  // ── Render loop ────────────────────────────────────────────────────────────

  private _startRenderLoop(): void {
    if (this._rafId) return;

    const tick = (now: DOMHighResTimeStamp) => {
      if (!this._playing) return;
      this._rafId = requestAnimationFrame(tick);

      // Pausa: não consome frames mas mantém o rAF rodando para retomar suavemente
      if (this.paused || !this._clockSeeded || this._queue.length === 0) return;

      const elapsed   = (now - this._wallStart) / 1000;
      const targetPts = this._ptsStart + elapsed * this._rate;

      // Descarta frames atrasados, preserva o mais recente
      while (this._queue.length > 1 && this._queue[0].pts < targetPts)
        this._queue.shift();

      const frame = this._queue[0];
      if (!frame) return;

      // Aguarda se o frame está no futuro (tolerância de 1.5 frames)
      if (frame.pts > targetPts + 1.5 / this._fps) return;

      this._queue.shift();
      this.currentTime = frame.pts;
      this.dispatchEvent(new CustomEvent('timeupdate', {
        detail: { currentTime: this.currentTime },
      }));

      this._drawYUV(frame.y, frame.u, frame.v, this._renderW, this._renderH);

      // Evento 'ended'
      if (!this.loop && this.duration > 0
          && this.currentTime >= this.duration - 1 / this._fps
          && this._queue.length === 0) {
        this.ended    = true;
        this.paused   = true;
        this._playing = false;
        this.dispatchEvent(new Event('ended'));
      }
    };

    this._rafId = requestAnimationFrame(tick);
  }

  // ── WebGL ──────────────────────────────────────────────────────────────────

  private _initGL(): void {
    const gl  = this._gl;
    const gl2 = this._isGL2 ? (gl as WebGL2RenderingContext) : null;

    // UNPACK_ALIGNMENT=1: sem padding de linha para resoluções não-múltiplas de 4
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    const VS = `
      attribute vec2 a_pos;
      varying   vec2 v_uv;
      void main() {
        gl_Position = vec4(a_pos, 0.0, 1.0);
        v_uv = vec2((a_pos.x + 1.0) * 0.5, 1.0 - (a_pos.y + 1.0) * 0.5);
      }`;

    // BT.601 full-range (yuv420p sem colorspace tag = full-range em arquivos desktop)
    const FS = `
      precision mediump float;
      uniform sampler2D u_Y, u_U, u_V;
      varying vec2 v_uv;
      void main() {
        float y = texture2D(u_Y, v_uv).r;
        float u = texture2D(u_U, v_uv).r - 0.5;
        float v = texture2D(u_V, v_uv).r - 0.5;
        gl_FragColor = vec4(
          clamp(y + 1.402 * v,                    0., 1.),
          clamp(y - 0.344136 * u - 0.714136 * v,  0., 1.),
          clamp(y + 1.772 * u,                    0., 1.),
          1.0);
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

    // PBOs — alocados UMA VEZ, tamanho máximo esperado
    if (gl2) {
      const mkPBO = (sz: number) => {
        const b = gl2.createBuffer()!;
        gl2.bindBuffer(gl2.PIXEL_UNPACK_BUFFER, b);
        gl2.bufferData(gl2.PIXEL_UNPACK_BUFFER, sz, gl2.DYNAMIC_DRAW);
        gl2.bindBuffer(gl2.PIXEL_UNPACK_BUFFER, null);
        return b;
      };
      const W = this._renderW, H = this._renderH;
      this._pboY = mkPBO(W * H);
      this._pboU = mkPBO((W >> 1) * (H >> 1));
      this._pboV = mkPBO((W >> 1) * (H >> 1));

      // Aloca texturas R8 para WebGL2
      const allocR8 = (tex: WebGLTexture, w: number, h: number) => {
        gl2.bindTexture(gl2.TEXTURE_2D, tex);
        gl2.texImage2D(gl2.TEXTURE_2D, 0, gl2.R8, w, h, 0, gl2.RED, gl2.UNSIGNED_BYTE, null);
      };
      allocR8(this._texY, W,        H);
      allocR8(this._texU, W >> 1,   H >> 1);
      allocR8(this._texV, W >> 1,   H >> 1);
      this._glAlloc = true;
    }

    this._glReady = true;
  }

  private _drawYUV(y: Uint8Array, u: Uint8Array, v: Uint8Array, w: number, h: number): void {
    if (!this._glReady) return;
    const gl  = this._gl;
    const gl2 = this._isGL2 ? gl as WebGL2RenderingContext : null;
    const cw  = w >> 1, ch = h >> 1;

    if (gl2 && this._pboY && this._pboU && this._pboV) {
      const up = (pbo: WebGLBuffer, tex: WebGLTexture, d: Uint8Array, tw: number, th: number, unit: number) => {
        gl2.activeTexture(gl2.TEXTURE0 + unit);
        gl2.bindTexture(gl2.TEXTURE_2D, tex);
        gl2.bindBuffer(gl2.PIXEL_UNPACK_BUFFER, pbo);
        gl2.bufferSubData(gl2.PIXEL_UNPACK_BUFFER, 0, d);
        gl2.texSubImage2D(gl2.TEXTURE_2D, 0, 0, 0, tw, th, gl2.RED, gl2.UNSIGNED_BYTE, 0);
        gl2.bindBuffer(gl2.PIXEL_UNPACK_BUFFER, null);
      };
      up(this._pboY, this._texY, y, w,  h,  0);
      up(this._pboU, this._texU, u, cw, ch, 1);
      up(this._pboV, this._texV, v, cw, ch, 2);
    } else {
      const up = (tex: WebGLTexture, d: Uint8Array, tw: number, th: number, unit: number) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        if (!this._glAlloc)
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, tw, th, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, d);
        else
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, tw, th, gl.LUMINANCE, gl.UNSIGNED_BYTE, d);
      };
      up(this._texY, y, w,  h,  0);
      up(this._texU, u, cw, ch, 1);
      up(this._texV, v, cw, ch, 2);
      this._glAlloc = true;
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // ── DOM ────────────────────────────────────────────────────────────────────

  private _buildDOM(): void {
    const shadow = this.shadowRoot!;
    const style  = document.createElement('style');
    style.textContent = `
      :host  { display: inline-block; }
      div    { position: relative; width: 100%; height: 100%; overflow: hidden; }
      canvas { width: 100%; height: 100%; display: block; }
      audio  { display: none; }`;

    this._canvas = document.createElement('canvas');
    this._audio  = document.createElement('audio');
    this._audio.crossOrigin = 'anonymous';
    this._canvas.width  = this._renderW;
    this._canvas.height = this._renderH;

    // Contexto GL — UMA VEZ aqui, nunca recriar
    const gl2 = this._canvas.getContext('webgl2', { antialias: false }) as WebGL2RenderingContext | null;
    if (gl2) {
      this._gl = gl2; this._isGL2 = true;
    } else {
      const gl1 = this._canvas.getContext('webgl', { antialias: false }) as WebGLRenderingContext | null;
      if (!gl1) throw new Error('[FFmpegVideo] WebGL indisponível.');
      this._gl = gl1; this._isGL2 = false;
    }

    const wrap = document.createElement('div');
    wrap.appendChild(this._canvas);
    wrap.appendChild(this._audio);
    shadow.appendChild(style);
    shadow.appendChild(wrap);
  }

  // ── Teardown ───────────────────────────────────────────────────────────────

  private _teardown(): void {
    if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
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
    this._glAlloc = false;
    this._playing = false;
  }

  // ── Path resolver ──────────────────────────────────────────────────────────

  private _resolvePath(src: string): string {
    // Caminho absoluto do SO → passa direto
    if (src.match(/^[A-Za-z]:[/\\]/) || src.startsWith('/')) return src;

    let p = src;

    if (p.startsWith('asset://')) {
      p = p.replace(/^asset:\/\/localhost\//, '').replace(/^asset:\/\//, '');
    } else if (p.startsWith('http://asset.localhost/') || p.startsWith('https://asset.localhost/')) {
      p = p.replace(/^https?:\/\/asset\.localhost\//, '');
    }

    p = decodeURIComponent(p);

    // Windows: converte barras e remove barra inicial antes do drive letter
    if (navigator.platform.startsWith('Win') || /^[A-Za-z][:/]/.test(p)) {
      p = p.replace(/\//g, '\\');
      if (!/^[A-Za-z]:\\/.test(p)) p = p.replace(/^\\/, '');
    }
    return p;
  }
}

customElements.define('ffmpeg-video', FFmpegVideo);