import { invoke } from '@tauri-apps/api/core';

export class FFmpegVideo extends HTMLElement {
    private canvas: HTMLCanvasElement;
    private gl: WebGLRenderingContext;
    private ws: WebSocket | null = null;
    private program: WebGLProgram | null = null;
    private texY: WebGLTexture | null = null;
    private texUV: WebGLTexture | null = null;
    private isPlaying: boolean = false;
    private isConnected_: boolean = false; // Renomeado para não conflitar com HTMLElement.isConnected

    // Guarda o timeout de retry para cancelar se pause() for chamado durante a espera
    private retryTimeout: ReturnType<typeof setTimeout> | null = null;

    // Dimensões atuais — usadas de forma consistente entre play() e renderFrame()
    private videoWidth: number = 1920;
    private videoHeight: number = 1080;

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        this.canvas = document.createElement('canvas');
        this.canvas.style.cssText = 'width:100%;height:100%;display:block;';

        // Dimensões de pixel iniciais — sem isso o canvas tem 300x150 (padrão HTML)
        // e os primeiros frames são renderizados com proporção errada
        this.canvas.width = this.videoWidth;
        this.canvas.height = this.videoHeight;

        this.shadowRoot!.appendChild(this.canvas);

        const glContext = this.canvas.getContext('webgl');
        if (!glContext) {
            throw new Error('WebGL não suportado neste ambiente.');
        }
        this.gl = glContext;
    }

    static get observedAttributes(): string[] {
        return ['src', 'width', 'height', 'autoplay'];
    }

    connectedCallback(): void {
        this.isConnected_ = true;
        this.setupWebGL();

        // Só dispara autoplay após estar conectado ao DOM e ter um src
        if (this.hasAttribute('autoplay') && this.getAttribute('src')) {
            this.play();
        }
    }

    disconnectedCallback(): void {
        // Limpa tudo ao sair do DOM
        this.isConnected_ = false;
        this.pause();
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
        if (oldValue === newValue) return; // Sem mudança real — ignora

        if (name === 'width' && newValue) {
            this.videoWidth = parseInt(newValue, 10);
            this.canvas.width = this.videoWidth;
        }
        if (name === 'height' && newValue) {
            this.videoHeight = parseInt(newValue, 10);
            this.canvas.height = this.videoHeight;
        }

        // Só reinicia se já estiver conectado ao DOM e já estiver tocando
        // (evita chamar play() no parser antes do connectedCallback)
        if (name === 'src' && newValue && this.isConnected_ && this.isPlaying) {
            this.play();
        }
    }

    // --- API pública ---

    get src(): string | null {
        return this.getAttribute('src');
    }

    set src(val: string | null) {
        if (val) this.setAttribute('src', val);
        else this.removeAttribute('src');
    }

    async play(): Promise<void> {
        const src = this.src;
        if (!src) return;

        // Para qualquer stream anterior (incluindo retries pendentes)
        this.pause();
        this.isPlaying = true;

        const w = this.videoWidth;
        const h = this.videoHeight;
        const realPath = this.resolvePath(src);

        try {
            await invoke('play_video', { path: realPath, width: w, height: h });
        } catch (error) {
            console.error('[FFmpegVideo] Erro ao iniciar via Tauri:', error);
            this.isPlaying = false;
            return;
        }

        // Aguarda o Rust inicializar o WebSocket server antes de conectar
        this.retryTimeout = setTimeout(() => {
            this.retryTimeout = null;
            if (this.isPlaying) {
                this.connectWebSocket(w, h);
            }
        }, 300);
    }

    pause(): void {
        // Cancela qualquer retry pendente
        if (this.retryTimeout !== null) {
            clearTimeout(this.retryTimeout);
            this.retryTimeout = null;
        }

        // Fecha o WebSocket atual
        if (this.ws) {
            this.ws.onmessage = null;
            this.ws.onerror = null;
            this.ws.onclose = null;
            this.ws.close();
            this.ws = null;
        }

        this.isPlaying = false;
    }

    // --- Privados ---

    /**
     * Resolve o caminho do asset do Tauri para um caminho de filesystem real.
     * Trata tanto asset:// (macOS/Linux) quanto asset.localhost (Windows).
     */
    private resolvePath(src: string): string {
        if (!src.startsWith('http') && !src.startsWith('asset')) {
            return src; // Já é um caminho absoluto
        }

        let path = src
            .replace(/^https?:\/\/asset\.localhost\//, '')
            .replace(/^asset:\/\/localhost\//, '');

        path = decodeURIComponent(path);

        // No Windows, converte barras para backslashes e adiciona letra de drive se necessário
        if (navigator.platform.startsWith('Win')) {
            path = path.replace(/\//g, '\\');
            if (!path.match(/^[A-Za-z]:\\/)) {
                path = path.replace(/^\\/, ''); // Remove barra inicial se houver
            }
        }

        return path;
    }

    private connectWebSocket(w: number, h: number, retriesLeft = 5): void {
        if (!this.isPlaying) return; // Abortado durante a espera

        const ws = new WebSocket('ws://127.0.0.1:9001');
        ws.binaryType = 'arraybuffer';
        this.ws = ws;

        // Flag local ao WebSocket — reseta corretamente a cada nova conexão
        let isFirstFrame = true;

        ws.onopen = () => {
            console.log('[FFmpegVideo] Conectado ao stream');
        };

        ws.onmessage = (event: MessageEvent<ArrayBuffer>) => {
            if (!this.isPlaying) return;
            const buffer = new Uint8Array(event.data);
            this.renderFrame(buffer, w, h, isFirstFrame);
            isFirstFrame = false;
        };

        ws.onerror = () => {
            // onerror sempre precede onclose — não age aqui, deixa o onclose decidir
        };

        ws.onclose = () => {
            if (!this.isPlaying) return; // Fechado intencionalmente por pause()

            if (retriesLeft > 0) {
                console.warn(`[FFmpegVideo] Conexão perdida, tentando novamente... (${retriesLeft} restantes)`);
                this.retryTimeout = setTimeout(() => {
                    this.retryTimeout = null;
                    this.connectWebSocket(w, h, retriesLeft - 1);
                }, 800);
            } else {
                console.error('[FFmpegVideo] Não foi possível conectar ao backend após todas as tentativas.');
                this.isPlaying = false;
            }
        };
    }

    private setupWebGL(): void {
        const gl = this.gl;

        const vsSource = `
            attribute vec2 a_pos;
            varying vec2 v_tex;
            void main() {
                gl_Position = vec4(a_pos, 0.0, 1.0);
                // Mapeia de clip-space [-1,1] para UV [0,1], com Y invertido
                v_tex = vec2((a_pos.x + 1.0) * 0.5, 1.0 - (a_pos.y + 1.0) * 0.5);
            }
        `;

        // Conversão NV12 (YUV semi-planar) → RGB
        // O plano Y está em LUMINANCE, o plano UV interleaved está em LUMINANCE_ALPHA
        const fsSource = `
            precision mediump float;
            uniform sampler2D u_Y;
            uniform sampler2D u_UV;
            varying vec2 v_tex;
            void main() {
                float y  = texture2D(u_Y,  v_tex).r - 0.0625;
                vec4  uv = texture2D(u_UV, v_tex);
                float u  = uv.r - 0.5;
                float v  = uv.a - 0.5;
                float r = clamp(1.1643*y + 1.5958*v,         0.0, 1.0);
                float g = clamp(1.1643*y - 0.39173*u - 0.81290*v, 0.0, 1.0);
                float b = clamp(1.1643*y + 2.017*u,          0.0, 1.0);
                gl_FragColor = vec4(r, g, b, 1.0);
            }
        `;

        const compile = (type: number, src: string): WebGLShader => {
            const shader = gl.createShader(type);
            if (!shader) throw new Error('Falha ao criar shader.');
            gl.shaderSource(shader, src);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                const log = gl.getShaderInfoLog(shader);
                gl.deleteShader(shader);
                throw new Error(`Erro ao compilar shader: ${log}`);
            }
            return shader;
        };

        this.program = gl.createProgram();
        if (!this.program) throw new Error('Falha ao criar programa WebGL.');

        gl.attachShader(this.program, compile(gl.VERTEX_SHADER, vsSource));
        gl.attachShader(this.program, compile(gl.FRAGMENT_SHADER, fsSource));
        gl.linkProgram(this.program);

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            throw new Error(`Falha ao linkar programa: ${gl.getProgramInfoLog(this.program)}`);
        }

        gl.useProgram(this.program);

        // Quad que cobre a tela inteira
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array([-1, -1,  1, -1,  -1, 1,  1, 1]),
            gl.STATIC_DRAW
        );

        const posLoc = gl.getAttribLocation(this.program, 'a_pos');
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        const makeTex = (unit: number, uniformName: string): WebGLTexture => {
            const tex = gl.createTexture();
            if (!tex) throw new Error('Falha ao criar textura.');
            gl.activeTexture(unit);
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.uniform1i(
                gl.getUniformLocation(this.program!, uniformName),
                unit === gl.TEXTURE0 ? 0 : 1
            );
            return tex;
        };

        this.texY  = makeTex(gl.TEXTURE0, 'u_Y');
        this.texUV = makeTex(gl.TEXTURE1, 'u_UV');
    }

    private renderFrame(buffer: Uint8Array, w: number, h: number, isFirst: boolean): void {
        const gl = this.gl;
        if (!this.texY || !this.texUV || !this.program) return;

        const ySize  = w * h;
        const uvSize = w * (h / 2); // NV12: UV interleaved, metade das linhas

        // Guarda contra buffers truncados (conexão iniciando ainda)
        if (buffer.byteLength < ySize + uvSize) return;

        const yData  = buffer.subarray(0, ySize);
        const uvData = buffer.subarray(ySize, ySize + uvSize);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texY);
        if (isFirst) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, w, h, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, yData);
        } else {
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.LUMINANCE, gl.UNSIGNED_BYTE, yData);
        }

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.texUV);
        // UV plane: w/2 pixels * h/2 linhas * 2 canais (U+V) = w * h/2 bytes
        // Passamos como LUMINANCE_ALPHA (2 bytes/pixel) com dimensões w/2 × h/2
        if (isFirst) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE_ALPHA, w / 2, h / 2, 0, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, uvData);
        } else {
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w / 2, h / 2, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, uvData);
        }

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
}

customElements.define('ffmpeg-video', FFmpegVideo);