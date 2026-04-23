<template>
    <div class="ffv-wrap">
        <canvas ref="canvasEl" :width="_renderW" :height="_renderH" />
        <img ref="previewImgEl" class="ffv-preview" :style="{ objectFit: objectFit }" />
        <!-- <audio> SEMPRE no DOM — nunca atrás de v-if — senão Vue destrói e recria -->
        <audio ref="audioEl" class="ffv-audio" preload="auto" crossorigin="anonymous" />
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick, computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'

// ── Tipos ───────────────────────────────────────────────────────────────────
interface FrameMeta { pts: number; duration: number; video_width: number; video_height: number; fps: number; has_audio: boolean; loop_restart: boolean }
interface QueuedFrame { pts: number; y: Uint8Array; u: Uint8Array; v: Uint8Array; w: number; h: number }

// ── Singletons ──────────────────────────────────────────────────────────────
let __seq = 0
const uid = () => `ffv${Date.now().toString(36)}${(++__seq).toString(36)}${(Math.random() * 1e6 | 0).toString(36)}`

// TextDecoder compartilhado entre instâncias (criado uma vez no módulo)
const _textDecoder = new TextDecoder()

function isWindows(): boolean {
    const d = (navigator as any).userAgentData
    if (d?.platform) return /win/i.test(d.platform)
    return /Windows/i.test(navigator.userAgent)
}

// ── Gesture unlock global (compartilhado entre todas as instâncias) ─────────
let _gestureOk = false
const _gestureQ: (() => void)[] = []
function _onGesture() {
    if (_gestureOk) return
    _gestureOk = true
    _gestureQ.splice(0).forEach(f => f())
    for (const e of ['click', 'keydown', 'touchstart', 'pointerdown'])
        window.removeEventListener(e, _onGesture, true)
}
if (typeof window !== 'undefined') {
    for (const e of ['click', 'keydown', 'touchstart', 'pointerdown'])
        window.addEventListener(e, _onGesture, true)
}
function waitGesture(): Promise<void> {
    return _gestureOk ? Promise.resolve() : new Promise(r => _gestureQ.push(r))
}

// ── Props & Emits ───────────────────────────────────────────────────────────
const props = withDefaults(defineProps<{
    src?: string
    width?: number | string
    height?: number | string
    autoplay?: boolean
    muted?: boolean
    loop?: boolean
    volume?: number
    playbackRate?: number
    previewOnly?: boolean
    noAudio?: boolean
    objectFit?: 'contain' | 'cover' | 'fill' | 'none'
}>(), {
    width: 1280,
    height: 720,
    volume: 1.0,
    playbackRate: 1.0,
    objectFit: 'contain',
})

const emit = defineEmits<{
    play: [any]; playing: [any]; pause: [any]; seeking: [any]; seeked: [any]
    ended: [any]; timeupdate: [any]; loadedmetadata: [any]; canplaythrough: [any]
    error: [any]
}>()

// ── Refs DOM ────────────────────────────────────────────────────────────────
const canvasEl = ref<HTMLCanvasElement | null>(null)
const previewImgEl = ref<HTMLImageElement | null>(null)
const audioEl = ref<HTMLAudioElement | null>(null)

// ── Estado Público (reativo) ────────────────────────────────────────────────
const duration = ref(0)
const paused = ref(true)
const ended = ref(false)
const readyState = ref(0)
const videoWidth = ref(0)
const videoHeight = ref(0)

let _currentTime = 0
const currentTime = computed({
    get: () => _currentTime,
    set: (v: number) => {
        if (!isFinite(v) || v < 0) return
        if (_playing) seek(v).catch(() => { })
        else _currentTime = v
    }
})

let _rate = props.playbackRate
const playbackRate = computed({
    get: () => _rate,
    set: (v: number) => {
        _rate = Math.max(0.25, Math.min(4.0, v))
        _sendCmd({ cmd: 'set_rate', rate: _rate })
    }
})

const currentVolume = ref(props.volume)
const currentMuted = ref(!!props.muted)
const currentLoop = ref(!!props.loop)

watch(() => props.volume, v => { if (v !== undefined) currentVolume.value = Math.max(0, Math.min(1, v)) })
watch(() => props.muted, v => { if (v !== undefined) currentMuted.value = !!v })
watch(() => props.loop, v => { if (v !== undefined) currentLoop.value = !!v })

watch(currentVolume, v => { if (audioEl.value) audioEl.value.volume = v })
watch(currentMuted, v => {
    if (audioEl.value) audioEl.value.muted = v
    if (v) _stopAudio()
    else if (_playing && !_audioConnected) _connectAudio()
})

const volume = computed({ get: () => currentVolume.value, set: (v: number) => { currentVolume.value = Math.max(0, Math.min(1, v)) } })
const muted = computed({ get: () => currentMuted.value, set: (v: boolean) => { currentMuted.value = !!v } })
const loop = computed({ get: () => currentLoop.value, set: (v: boolean) => { currentLoop.value = !!v; _sendCmd({ cmd: 'set_loop', enabled: v }) } })

const src = computed(() => props.src)
const previewOnly = computed(() => !!props.previewOnly)
const noAudio = computed(() => !!props.noAudio)
const objectFit = computed(() => props.objectFit)

// ── Estado Interno ──────────────────────────────────────────────────────────
const _sid = uid()
const _tag = () => `[FFV ${_sid.slice(-6)}]`

let _gl: WebGLRenderingContext | WebGL2RenderingContext | null = null
let _isGL2 = false
let _prog: WebGLProgram | null = null
let _texY: WebGLTexture | null = null
let _texU: WebGLTexture | null = null
let _texV: WebGLTexture | null = null
let _pboY: WebGLBuffer | null = null
let _pboU: WebGLBuffer | null = null
let _pboV: WebGLBuffer | null = null
let _glReady = false
let _texW = 0; let _texH = 0

// Cache do viewport para evitar recalcular toda frame
let _cachedViewport: [number, number, number, number] = [0, 0, 0, 0]
let _viewportDirty = true

let _ws: WebSocket | null = null
let _ctrlWs: WebSocket | null = null
let _queue: QueuedFrame[] = []
const _maxQueue = 6  // reduzido de 12 — menos buffer, menos delay

let _wallStart = 0; let _ptsStart = 0
let _clockSeeded = false
let _rafId = 0
let _playing = false
let _renderW = Number(props.width) || 1280
let _renderH = Number(props.height) || 720
let _firstFrame = true
let _retryTimer: ReturnType<typeof setTimeout> | null = null
let _audioRetry: ReturnType<typeof setTimeout> | null = null
let _audioFallbackTimer: ReturnType<typeof setTimeout> | null = null
let _audioConnected = false
let _fps = 30

// Debounce para watcher de src (evita teardown/play múltiplos)
let _srcChangeTimer: ReturnType<typeof setTimeout> | null = null

// ── Mock Event ──────────────────────────────────────────────────────────────
function getMockEvent() {
    return {
        target: {
            videoWidth: videoWidth.value,
            videoHeight: videoHeight.value,
            duration: duration.value,
            currentTime: _currentTime,
            paused: paused.value,
            ended: ended.value,
            readyState: readyState.value,
            querySelector: (selector: string) => selector === 'audio' ? audioEl.value : null
        }
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function _resolvePath(p: string): string {
    if (p.match(/^[A-Za-z]:[/\\]/) || p.startsWith('/')) return p
    let res = p
    if (res.startsWith('asset://')) res = res.replace(/^asset:\/\/localhost\//, '').replace(/^asset:\/\//, '')
    else if (res.startsWith('http://asset.localhost/') || res.startsWith('https://asset.localhost/'))
        res = res.replace(/^https?:\/\/asset\.localhost\//, '')
    res = decodeURIComponent(res)
    if (isWindows() || /^[A-Za-z][:/]/.test(res)) {
        res = res.replace(/\//g, '\\')
        if (!/^[A-Za-z]:\\/.test(res)) res = res.replace(/^\\/, '')
    }
    return res
}

function _sendCmd(cmd: object): void {
    if (_ctrlWs?.readyState === WebSocket.OPEN) _ctrlWs.send(JSON.stringify(cmd))
}

function _teardown(): void {
    if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null }
    if (_audioRetry) { clearTimeout(_audioRetry); _audioRetry = null }
    if (_audioFallbackTimer) { clearTimeout(_audioFallbackTimer); _audioFallbackTimer = null }
    cancelAnimationFrame(_rafId); _rafId = 0
    if (_ws) { _ws.onmessage = null; _ws.onerror = null; _ws.onclose = null; _ws.close(); _ws = null }
    if (_ctrlWs) { _ctrlWs.onclose = null; _ctrlWs.onerror = null; _ctrlWs.close(); _ctrlWs = null }
    _stopAudio()
    _queue.length = 0
    _playing = false
}

// ── WebGL ───────────────────────────────────────────────────────────────────
function _initGL(): void {
    if (!canvasEl.value) return
    const gl2 = canvasEl.value.getContext('webgl2', { antialias: false, preserveDrawingBuffer: false }) as WebGL2RenderingContext | null
    if (gl2) { _gl = gl2; _isGL2 = true }
    else {
        const gl1 = canvasEl.value.getContext('webgl', { antialias: false, preserveDrawingBuffer: false }) as WebGLRenderingContext | null
        if (!gl1) throw new Error('WebGL indisponível')
        _gl = gl1; _isGL2 = false
    }

    const gl = _gl
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)

    const VS = `
    attribute vec2 a_pos; varying vec2 v_uv;
    void main() {
      gl_Position = vec4(a_pos, 0.0, 1.0);
      v_uv = vec2((a_pos.x+1.0)*0.5, 1.0-(a_pos.y+1.0)*0.5);
    }`

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
    }`

    const mkS = (t: number, s: string) => {
        const sh = gl.createShader(t)!
        gl.shaderSource(sh, s); gl.compileShader(sh)
        return sh
    }

    const prog = gl.createProgram()!
    gl.attachShader(prog, mkS(gl.VERTEX_SHADER, VS))
    gl.attachShader(prog, mkS(gl.FRAGMENT_SHADER, FS))
    gl.linkProgram(prog)
    gl.useProgram(prog); _prog = prog

    const vb = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, vb)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const a = gl.getAttribLocation(prog, 'a_pos')
    gl.enableVertexAttribArray(a)
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0)

    const mkT = (u: number, n: string) => {
        const t = gl.createTexture()!
        gl.activeTexture(gl.TEXTURE0 + u)
        gl.bindTexture(gl.TEXTURE_2D, t)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.uniform1i(gl.getUniformLocation(prog, n), u)
        return t
    }

    _texY = mkT(0, 'u_Y'); _texU = mkT(1, 'u_U'); _texV = mkT(2, 'u_V')
    // Define clear color uma vez (não muda entre frames)
    gl.clearColor(0, 0, 0, 1)
    _glReady = true
    _viewportDirty = true
}

/// Calcula viewport do object-fit e guarda em cache. Só recalcula se dirty.
function _computeViewport(): [number, number, number, number] {
    if (!_glReady || !canvasEl.value) return [0, 0, 0, 0]
    const fit = objectFit.value
    const cw = canvasEl.value.width
    const ch = canvasEl.value.height
    const vw = videoWidth.value || cw
    const vh = videoHeight.value || ch

    if (fit === 'fill' || vw === 0 || vh === 0) return [0, 0, cw, ch]

    const canvasRatio = cw / ch
    const videoRatio = vw / vh
    let vpW: number, vpH: number, vpX: number, vpY: number

    if (fit === 'cover') {
        if (canvasRatio > videoRatio) { vpW = cw; vpH = Math.round(cw / videoRatio) }
        else { vpH = ch; vpW = Math.round(ch * videoRatio) }
    } else if (fit === 'none') {
        vpW = vw; vpH = vh
    } else { // contain
        if (canvasRatio > videoRatio) { vpH = ch; vpW = Math.round(ch * videoRatio) }
        else { vpW = cw; vpH = Math.round(cw / videoRatio) }
    }
    vpX = Math.round((cw - vpW) / 2); vpY = Math.round((ch - vpH) / 2)
    return [vpX, vpY, vpW, vpH]
}

function _invalidateViewport(): void { _viewportDirty = true }

function _ensureGLAlloc(w: number, h: number): void {
    if (_texW === w && _texH === h) return
    const gl = _gl!, gl2 = _isGL2 ? gl as WebGL2RenderingContext : null
    const cw = w >> 1, ch = h >> 1
    if (gl2) {
        const rPBO = (b: WebGLBuffer | null, sz: number) => {
            const buf = b ?? gl2.createBuffer()!
            gl2.bindBuffer(gl2.PIXEL_UNPACK_BUFFER, buf)
            gl2.bufferData(gl2.PIXEL_UNPACK_BUFFER, sz, gl2.DYNAMIC_DRAW)
            gl2.bindBuffer(gl2.PIXEL_UNPACK_BUFFER, null)
            return buf
        }
        _pboY = rPBO(_pboY, w * h)
        _pboU = rPBO(_pboU, cw * ch)
        _pboV = rPBO(_pboV, cw * ch)
        const aR8 = (t: WebGLTexture, tw: number, th: number) => {
            gl2.bindTexture(gl2.TEXTURE_2D, t)
            gl2.texImage2D(gl2.TEXTURE_2D, 0, gl2.R8, tw, th, 0, gl2.RED, gl2.UNSIGNED_BYTE, null)
        }
        aR8(_texY!, w, h); aR8(_texU!, cw, ch); aR8(_texV!, cw, ch)
    } else {
        const aL = (t: WebGLTexture, tw: number, th: number) => {
            gl.bindTexture(gl.TEXTURE_2D, t)
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, tw, th, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, null)
        }
        aL(_texY!, w, h); aL(_texU!, cw, ch); aL(_texV!, cw, ch)
    }
    _texW = w; _texH = h
    _viewportDirty = true
}

function _drawYUV(y: Uint8Array, u: Uint8Array, v: Uint8Array, w: number, h: number): void {
    if (!_glReady || !canvasEl.value) return
    _ensureGLAlloc(w, h)
    const gl = _gl!, gl2 = _isGL2 ? gl as WebGL2RenderingContext : null
    const cw = w >> 1, ch = h >> 1, yS = w * h, uvS = cw * ch
    const yV = y.byteLength === yS ? y : y.subarray(0, yS)
    const uV = u.byteLength === uvS ? u : u.subarray(0, uvS)
    const vV = v.byteLength === uvS ? v : v.subarray(0, uvS)

    // Recalcula viewport só quando muda (não toda frame)
    if (_viewportDirty) {
        _cachedViewport = _computeViewport()
        _viewportDirty = false
    }

    const [vpX, vpY, vpW, vpH] = _cachedViewport
    const canvasW = canvasEl.value.width
    const canvasH = canvasEl.value.height

    // Só precisa limpar se houver letterbox (contain ou none). Cover/fill preenchem tudo.
    if (vpX !== 0 || vpY !== 0 || vpW !== canvasW || vpH !== canvasH) {
        gl.viewport(0, 0, canvasW, canvasH)
        gl.clear(gl.COLOR_BUFFER_BIT)
    }
    gl.viewport(vpX, vpY, vpW, vpH)

    if (gl2 && _pboY && _pboU && _pboV) {
        const up = (p: WebGLBuffer, t: WebGLTexture, d: Uint8Array, tw: number, th: number, i: number) => {
            gl2.activeTexture(gl2.TEXTURE0 + i); gl2.bindTexture(gl2.TEXTURE_2D, t)
            gl2.bindBuffer(gl2.PIXEL_UNPACK_BUFFER, p)
            gl2.bufferSubData(gl2.PIXEL_UNPACK_BUFFER, 0, d)
            gl2.texSubImage2D(gl2.TEXTURE_2D, 0, 0, 0, tw, th, gl2.RED, gl2.UNSIGNED_BYTE, 0)
            gl2.bindBuffer(gl2.PIXEL_UNPACK_BUFFER, null)
        }
        up(_pboY, _texY!, yV, w, h, 0); up(_pboU, _texU!, uV, cw, ch, 1); up(_pboV, _texV!, vV, cw, ch, 2)
    } else {
        const up = (t: WebGLTexture, d: Uint8Array, tw: number, th: number, i: number) => {
            gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t)
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, tw, th, gl.LUMINANCE, gl.UNSIGNED_BYTE, d)
        }
        up(_texY!, yV, w, h, 0); up(_texU!, uV, cw, ch, 1); up(_texV!, vV, cw, ch, 2)
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
}

// ── WebSocket ───────────────────────────────────────────────────────────────
function _connectVideoWS(retries = 12): void {
    if (!_playing) return
    const ws = new WebSocket(`ws://127.0.0.1:9001/${_sid}`)
    ws.binaryType = 'arraybuffer'
    _ws = ws
    ws.onopen = () => _startRenderLoop()
    ws.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
        if (!_playing) return
        _enqueue(new Uint8Array(data))
    }
    ws.onerror = () => { }
    ws.onclose = () => {
        if (!_playing) return
        if (retries > 0) _retryTimer = setTimeout(() => { _retryTimer = null; _connectVideoWS(retries - 1) }, 350)
        else { _playing = false; paused.value = true; emit('error', getMockEvent()) }
    }
}

function _connectCtrlWS(retries = 5): void {
    if (!_playing) return
    const ws = new WebSocket(`ws://127.0.0.1:9003/${_sid}`)
    _ctrlWs = ws
    ws.onclose = () => {
        _ctrlWs = null
        if (_playing && retries > 0) setTimeout(() => _connectCtrlWS(retries - 1), 400)
    }
    ws.onerror = () => { }
}

// ── Áudio ───────────────────────────────────────────────────────────────────
/// Verifica via HEAD se a sessão existe e tem áudio.
/// Faz retry porque o play_video pode ainda estar registrando a sessão no Rust.
async function _probeAudio(): Promise<boolean> {
    const url = `http://127.0.0.1:9002/${_sid}/stream.mp4`
    for (let attempt = 0; attempt < 6; attempt++) {
        try {
            const ctrl = new AbortController()
            const to = setTimeout(() => ctrl.abort(), 1000)
            const r = await fetch(url, { method: 'HEAD', signal: ctrl.signal })
            clearTimeout(to)
            console.log(`${_tag()} probe attempt=${attempt} status=${r.status}`)
            if (r.status === 200) return true
            if (r.status === 204) return false   // sem áudio confirmado
            // 404 → sessão ainda não existe no Rust, tenta de novo
        } catch (e) {
            console.warn(`${_tag()} probe falhou (${attempt}):`, e)
        }
        await new Promise(r => setTimeout(r, 300))
    }
    return false
}

async function _connectAudio(): Promise<void> {
    if (!_playing || currentMuted.value || noAudio.value || !audioEl.value) return
    if (_audioConnected) return

    const audio = audioEl.value

    // Probe ANTES de setar src — se endpoint retorna 204, nem tenta
    const hasAudio = await _probeAudio()
    if (!hasAudio) {
        console.log(`${_tag()} audio: endpoint sem áudio (204)`)
        return
    }

    if (!_playing || currentMuted.value) return  // pode ter mudado durante o probe

    const url = `http://127.0.0.1:9002/${_sid}/stream.mp4?t=${Date.now()}`
    console.log(`${_tag()} audio →`, url)

    audio.src = url
    audio.volume = currentVolume.value
    audio.muted = false
    audio.load()

    _audioConnected = true

    const tryPlay = () => {
        const p = audio.play()
        if (!p || typeof p.then !== 'function') return
        p.then(() => console.log(`${_tag()} ✔ audio playing`))
            .catch(err => {
                console.warn(`${_tag()} autoplay bloqueado (${err.name}) → gesture`)
                waitGesture().then(() => {
                    if (!_playing || currentMuted.value) return
                    audio.play()
                        .then(() => console.log(`${_tag()} ✔ audio após gesture`))
                        .catch(e2 => console.warn(`${_tag()} ✘ audio após gesture:`, e2))
                })
            })
    }

    audio.oncanplay = () => {
        audio.oncanplay = null
        if (_audioFallbackTimer) { clearTimeout(_audioFallbackTimer); _audioFallbackTimer = null }
        tryPlay()
    }

    // Fallback: forçar play mesmo sem canplay após 2.5s
    if (_audioFallbackTimer) clearTimeout(_audioFallbackTimer)
    _audioFallbackTimer = setTimeout(() => {
        _audioFallbackTimer = null
        if (!_playing || audio.readyState >= 2) return
        console.log(`${_tag()} audio fallback play (rs=${audio.readyState})`)
        tryPlay()
    }, 2500)

    audio.onerror = () => {
        if (_audioFallbackTimer) { clearTimeout(_audioFallbackTimer); _audioFallbackTimer = null }
        const e = audio.error
        console.warn(`${_tag()} ✘ <audio> error code=${e?.code}`)
        _audioConnected = false
    }
}

function _stopAudio(): void {
    if (_audioRetry) { clearTimeout(_audioRetry); _audioRetry = null }
    if (_audioFallbackTimer) { clearTimeout(_audioFallbackTimer); _audioFallbackTimer = null }
    _audioConnected = false
    if (!audioEl.value) return
    audioEl.value.oncanplay = null
    audioEl.value.onerror = null
    audioEl.value.pause()
    audioEl.value.removeAttribute('src')
    audioEl.value.load()
}

// ── Quadros ─────────────────────────────────────────────────────────────────
function _enqueue(data: Uint8Array): void {
    const sep = data.indexOf(0x7C)
    if (sep === -1) return
    let meta: FrameMeta
    try { meta = JSON.parse(_textDecoder.decode(data.subarray(0, sep))) } catch { return }

    const rw = meta.video_width | 0
    const rh = meta.video_height | 0
    if (rw <= 0 || rh <= 0 || (rw & 1) || (rh & 1)) return

    const cw = rw >> 1, ch = rh >> 1, ySize = rw * rh, uvSize = cw * ch
    const pixels = data.subarray(sep + 1)
    if (pixels.byteLength < ySize + uvSize * 2) return

    const y = pixels.subarray(0, ySize)
    const u = pixels.subarray(ySize, ySize + uvSize)
    const v = pixels.subarray(ySize + uvSize, ySize + uvSize * 2)

    if (_firstFrame) {
        duration.value = meta.duration
        videoWidth.value = meta.video_width
        videoHeight.value = meta.video_height
        _fps = meta.fps > 0 ? meta.fps : 30
        readyState.value = 4
        _viewportDirty = true
        emit('loadedmetadata', getMockEvent())
        emit('canplaythrough', getMockEvent())
    }

    if (meta.loop_restart) {
        _wallStart = performance.now()
        _ptsStart = meta.pts
        _clockSeeded = true
    }

    if (_queue.length >= _maxQueue) _queue.shift()
    _queue.push({ pts: meta.pts, y, u, v, w: rw, h: rh })

    if (_firstFrame) {
        _firstFrame = false
        _wallStart = performance.now()
        _ptsStart = meta.pts
        _clockSeeded = true
    }
}

function _startRenderLoop(): void {
    if (_rafId) return
    let _lastTimeupdate = 0
    const tick = (now: DOMHighResTimeStamp) => {
        if (!_playing) return
        _rafId = requestAnimationFrame(tick)
        if (paused.value || !_clockSeeded || !_queue.length) return

        const elapsed = (now - _wallStart) / 1000
        const targetPts = _ptsStart + elapsed * _rate
        const tol = 0.5 / Math.max(_fps, 1)

        while (_queue.length > 1 && _queue[0].pts < targetPts - tol) _queue.shift()
        const frame = _queue[0]
        if (!frame || frame.pts > targetPts + 2 / _fps) return

        _queue.shift()
        _currentTime = frame.pts

        // Throttle timeupdate a cada 250ms (API <video> faz similar)
        if (now - _lastTimeupdate > 250) {
            emit('timeupdate', getMockEvent())
            _lastTimeupdate = now
        }

        _drawYUV(frame.y, frame.u, frame.v, frame.w, frame.h)

        if (!currentLoop.value && duration.value > 0 && _currentTime >= duration.value - 1 / _fps && !_queue.length) {
            ended.value = true; paused.value = true; _playing = false
            emit('ended', getMockEvent())
        }
    }
    _rafId = requestAnimationFrame(tick)
}

// ── Controladores Públicos ──────────────────────────────────────────────────
async function _loadPreview(): Promise<void> {
    const source = src.value
    if (!source) return
    _teardown()
    try {
        const path = _resolvePath(source)
        const bytes: number[] = await invoke('get_video_preview', {
            path, timestamp: _currentTime || 0, width: _renderW || undefined, height: _renderH || undefined
        })
        const u8 = new Uint8Array(bytes)
        const blob = new Blob([u8], { type: 'image/jpeg' })
        const url = URL.createObjectURL(blob)

        if (previewImgEl.value) {
            previewImgEl.value.onload = () => URL.revokeObjectURL(url)
            previewImgEl.value.src = url
            previewImgEl.value.style.display = 'block'
        }
        if (canvasEl.value) canvasEl.value.style.display = 'none'
    } catch (e) { console.warn(`${_tag()} preview:`, e) }
}

async function play(): Promise<void> {
    if (_playing && !paused.value) return
    if (_playing && paused.value) { resume(); return }

    const source = src.value
    if (!source) return

    if (previewImgEl.value) previewImgEl.value.style.display = 'none'
    if (canvasEl.value) canvasEl.value.style.display = 'block'

    _teardown()
    _playing = true; paused.value = false; ended.value = false
    _firstFrame = true; _clockSeeded = false; _queue.length = 0

    // ── Detecta tamanho REAL do canvas renderizado ──────────────────────────
    // Se o elemento está em 800×450 na tela, não faz sentido decodar em
    // 1920×1080. Usa getBoundingClientRect × devicePixelRatio para pegar o
    // tamanho exato em pixels físicos. Respeita props.width/height se setados
    // explicitamente pelo usuário.
    //
    let targetW = _renderW
    let targetH = _renderH
    if (canvasEl.value && !props.width && !props.height) {
        const rect = canvasEl.value.getBoundingClientRect()
        const dpr = window.devicePixelRatio || 1
        if (rect.width > 0 && rect.height > 0) {
            // Limita a 1920 de largura máxima mesmo em displays 4K
            targetW = Math.min(1920, Math.ceil(rect.width * dpr))
            targetH = Math.min(1080, Math.ceil(rect.height * dpr))
            _renderW = targetW
            _renderH = targetH
            canvasEl.value.width = targetW
            canvasEl.value.height = targetH
        }
    }

    const startSeek = _currentTime > 0 ? _currentTime : 0
    const path = _resolvePath(source)
    const skipAudio = noAudio.value || currentMuted.value

    try {
        await invoke('play_video', {
            sessionId: _sid, path, width: targetW, height: targetH,
            noAudio: skipAudio, loopVideo: currentLoop.value
        })
    } catch (e) {
        console.error(`${_tag()} play_video falhou:`, e)
        _playing = false; paused.value = true; return
    }

    if (startSeek > 0) {
        try { await invoke('send_video_command', { sessionId: _sid, command: { cmd: 'seek', time: startSeek } }) }
        catch { }
    }

    emit('play', getMockEvent())
    emit('playing', getMockEvent())

    _retryTimer = setTimeout(() => {
        _retryTimer = null
        if (!_playing) return
        _connectVideoWS()
        _connectCtrlWS()
        if (!skipAudio) _connectAudio().catch(() => { })
    }, 500)
}

function pause(): void {
    if (paused.value) return
    paused.value = true
    _sendCmd({ cmd: 'pause' })
    if (audioEl.value) audioEl.value.pause()
    emit('pause', getMockEvent())
}

function resume(): void {
    if (!paused.value || !_playing) return
    paused.value = false
    _sendCmd({ cmd: 'play' })
    if (_clockSeeded && _queue.length > 0) {
        _wallStart = performance.now()
        _ptsStart = _queue[0].pts
    }
    if (audioEl.value && audioEl.value.src) audioEl.value.play().catch(() => { })
    emit('play', getMockEvent())
    emit('playing', getMockEvent())
}

async function seek(time: number): Promise<void> {
    emit('seeking', getMockEvent())
    _currentTime = time
    _queue.length = 0
    _firstFrame = true
    _clockSeeded = false

    try { await invoke('send_video_command', { sessionId: _sid, command: { cmd: 'seek', time } }) }
    catch (e) { console.warn(`${_tag()} seek:`, e); _sendCmd({ cmd: 'seek', time }) }

    _stopAudio()
    if (!noAudio.value && !currentMuted.value) {
        if (_audioRetry) clearTimeout(_audioRetry)
        _audioRetry = setTimeout(() => { _audioRetry = null; _connectAudio().catch(() => { }) }, 400)
    }
    emit('seeked', getMockEvent())
}

// ── Watchers ────────────────────────────────────────────────────────────────
// Debounced — evita teardown/play múltiplos quando src muda rápido
watch(src, (newSrc) => {
    if (_srcChangeTimer) clearTimeout(_srcChangeTimer)
    _srcChangeTimer = setTimeout(async () => {
        _srcChangeTimer = null
        if (!newSrc) return
        _teardown()
        // Aguarda stop_video completar no Rust antes de nova sessão.
        // Sem isso o probe HEAD pode pegar sessão antiga ou dar 404 na transição.
        try { await invoke('stop_video', { sessionId: _sid }) } catch { }
        _currentTime = 0
        _firstFrame = true
        _queue.length = 0
        ended.value = false
        readyState.value = 0
        await nextTick()
        if (previewOnly.value) _loadPreview()
        else play().catch(console.error)
    }, 50)
})

watch(objectFit, _invalidateViewport)
watch(videoWidth, _invalidateViewport)
watch(videoHeight, _invalidateViewport)
watch(() => props.width, (v) => {
    _renderW = Number(v) || 1280
    if (canvasEl.value) canvasEl.value.width = _renderW
    _invalidateViewport()
})
watch(() => props.height, (v) => {
    _renderH = Number(v) || 720
    if (canvasEl.value) canvasEl.value.height = _renderH
    _invalidateViewport()
})

// ── Ciclo de Vida ───────────────────────────────────────────────────────────
onMounted(() => {
    if (canvasEl.value) {
        canvasEl.value.width = _renderW
        canvasEl.value.height = _renderH
        _initGL()
    }
    if (audioEl.value) {
        audioEl.value.muted = currentMuted.value
        audioEl.value.volume = currentVolume.value
    }
    if (previewOnly.value && src.value) _loadPreview()
    else if (props.autoplay && src.value) play()
})

onUnmounted(() => {
    if (_srcChangeTimer) { clearTimeout(_srcChangeTimer); _srcChangeTimer = null }
    _teardown()
    invoke('stop_video', { sessionId: _sid }).catch(() => { })
})

// ── API Exposta ─────────────────────────────────────────────────────────────
defineExpose({
    play, pause, resume, seek,
    currentTime, playbackRate,
    duration: computed(() => duration.value),
    paused: computed(() => paused.value),
    ended: computed(() => ended.value),
    readyState: computed(() => readyState.value),
    videoWidth: computed(() => videoWidth.value),
    videoHeight: computed(() => videoHeight.value),
    volume, muted, loop, src, previewOnly, noAudio, objectFit
})
</script>

<style scoped>
.ffv-wrap {
    display: block;
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
}

canvas {
    width: 100%;
    height: 100%;
    display: block;
}

.ffv-preview {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: none;
}

.ffv-audio {
    display: none;
    position: absolute;
    width: 0;
    height: 0;
}
</style>