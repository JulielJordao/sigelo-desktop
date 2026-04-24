<template>
    <!-- Motor selecionado automaticamente baseado em videoEngine + codec do arquivo -->
    <div class="smart-video-wrap">
        <!-- ── Motor FFmpeg ──────────────────────────────────────────────── -->
        <FFmpegVideo
            v-if="resolvedEngine === 'ffmpeg'"
            ref="ffmpegRef"
            v-bind="ffmpegProps"
            @play="$emit('play', $event)"
            @playing="$emit('playing', $event)"
            @pause="$emit('pause', $event)"
            @seeking="$emit('seeking', $event)"
            @seeked="$emit('seeked', $event)"
            @ended="$emit('ended', $event)"
            @timeupdate="$emit('timeupdate', $event)"
            @loadedmetadata="$emit('loadedmetadata', $event)"
            @canplaythrough="$emit('canplaythrough', $event)"
            @error="onFFmpegError"
        />

        <!-- ── Motor Nativo ─────────────────────────────────────────────── -->
        <video
            v-else-if="resolvedEngine === 'native'"
            ref="nativeRef"
            :src="props.src"
            :autoplay="props.autoplay"
            :muted="!!(props.muted || props.noAudio)"
            :loop="props.loop"
            playsinline
            :style="nativeStyle"
            class="smart-native-video"
            @play="$emit('play', $event)"
            @playing="$emit('playing', $event)"
            @pause="$emit('pause', $event)"
            @seeking="$emit('seeking', $event)"
            @seeked="$emit('seeked', $event)"
            @ended="$emit('ended', $event)"
            @timeupdate="$emit('timeupdate', $event)"
            @loadedmetadata="onNativeMeta"
            @canplaythrough="$emit('canplaythrough', $event)"
            @error="onNativeError"
        />

        <!-- Loading / fallback indicator -->
        <div v-if="resolvedEngine === null" class="smart-detecting">
            <v-progress-circular indeterminate size="24" color="primary" />
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useConfigStore } from '../stores/useConfigStore'
import FFmpegVideo from '../FFmpegVideo.vue'

// ── Tipos ────────────────────────────────────────────────────────────────────
type Engine = 'ffmpeg' | 'native'
type EngineMode = 'ffmpeg' | 'native' | 'hybrid' | 'smart'

// ── Props ────────────────────────────────────────────────────────────────────
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
    objectFit?: 'contain' | 'cover' | 'fill' | 'none',
    previewTimestamp?: number
}>(), {
    width: 1280,
    height: 720,
    volume: 1.0,
    playbackRate: 1.0,
    objectFit: 'contain',
    previewTimestamp: 0.5
})

const emit = defineEmits<{
    play: [any]; playing: [any]; pause: [any]; seeking: [any]; seeked: [any]
    ended: [any]; timeupdate: [any]; loadedmetadata: [any]; canplaythrough: [any]
    error: [any]
}>()

// ── Refs ─────────────────────────────────────────────────────────────────────
const ffmpegRef = ref<InstanceType<typeof FFmpegVideo> | null>(null)
const nativeRef = ref<HTMLVideoElement | null>(null)
const configStore = useConfigStore()

// ── Motor resolvido ──────────────────────────────────────────────────────────
const resolvedEngine = ref<Engine | null>(null)

// ═════════════════════════════════════════════════════════════════════════════
// DETECÇÃO DE MOTOR
// ═════════════════════════════════════════════════════════════════════════════
const NATIVE_COMPATIBLE_EXTENSIONS = new Set([
    'mp4', 'm4v', 'webm', 'ogv', 'mov'
])

const FFMPEG_ONLY_EXTENSIONS = new Set([
    'mkv', 'avi', 'flv', 'wmv', 'ts', 'mts', 'prores', 'mxf'
])

function detectEngine(src: string): Engine {
    const mode = (configStore.settings.videoEngine ?? 'smart') as EngineMode

    switch (mode) {
        case 'ffmpeg': return 'ffmpeg'
        case 'native': return 'native'
        case 'hybrid':
        case 'smart': {
            const ext = src.split('?')[0].split('.').pop()?.toLowerCase() ?? ''
            if (FFMPEG_ONLY_EXTENSIONS.has(ext)) return 'ffmpeg'
            if (NATIVE_COMPATIBLE_EXTENSIONS.has(ext)) return 'native'
            return mode === 'smart' ? 'native' : 'ffmpeg'
        }
    }
}

// ── Resolve motor quando src muda ────────────────────────────────────────────
watch(() => props.src, (newSrc) => {
    if (!newSrc) { resolvedEngine.value = null; return }
    resolvedEngine.value = detectEngine(newSrc)
}, { immediate: true })

// ── Reaplica volume/rate/muted quando nativo monta ───────────────────────────
watch([resolvedEngine, nativeRef], async () => {
    if (resolvedEngine.value !== 'native') return
    if (!props.previewOnly) return
    await nextTick()
    const v = nativeRef.value
    if (!v) return

    const applyPreview = async () => {
        const ts = props.previewTimestamp ?? 0.5
        try {
            v.currentTime = ts
            v.pause()
        } catch { }
    }

    // Se já tem metadados (src já carregado), aplica direto
    if (v.readyState >= 1) {
        await applyPreview()
    } else {
        // Espera o loadedmetadata para seekar
        v.addEventListener('loadedmetadata', applyPreview, { once: true })
    }
}, { immediate: true })

// ── Props para FFmpegVideo ────────────────────────────────────────────────────
const ffmpegProps = computed(() => ({
    src: props.src,
    width: props.width,
    height: props.height,
    autoplay: props.autoplay,
    muted: props.muted,
    loop: props.loop,
    volume: props.volume,
    playbackRate: props.playbackRate,
    previewOnly: props.previewOnly,
    noAudio: props.noAudio,
    objectFit: props.objectFit,
    previewTimestamp: props.previewTimestamp
}))

// ── Estilo para <video> nativo (objectFit via CSS) ───────────────────────────
const nativeStyle = computed<Record<string, string>>(() => ({
    width: '100%',
    height: '100%',
    objectFit: props.objectFit === 'none' ? 'fill' : (props.objectFit ?? 'contain'),
}))

// ── Watchers para sincronizar atributos no nativo ─────────────────────────────
watch(() => props.volume, (v) => {
    if (nativeRef.value) nativeRef.value.volume = Math.max(0, Math.min(1, v ?? 1.0))
})

// ── Sincroniza muted em tempo real nos dois motores ───────────────────────────
watch(() => props.muted, (m) => {
    const isMuted = !!(m || props.noAudio)
    // Nativo: setar via JS (atributo HTML não reage após mount)
    if (nativeRef.value) {
        nativeRef.value.muted = isMuted
        nativeRef.value.volume = isMuted ? 0 : (props.volume ?? 1.0)
    }
    // FFmpeg: repassa via computed (FFmpegVideo observa props.muted via watch interno)
    // Nada a fazer aqui — ffmpegProps já é reativo e FFmpegVideo reage
})

watch(() => props.noAudio, (noA) => {
    const isMuted = !!(props.muted || noA)
    if (nativeRef.value) {
        nativeRef.value.muted = isMuted
        nativeRef.value.volume = isMuted ? 0 : (props.volume ?? 1.0)
    }
})

watch(() => props.volume, (v) => {
    if (nativeRef.value) {
        nativeRef.value.volume = Math.max(0, Math.min(1, v ?? 1.0))
        // Se volume > 0, garante que não fique mudo (a menos que muted esteja ativo)
        if ((v ?? 0) > 0 && !props.muted && !props.noAudio) {
            nativeRef.value.muted = false
        }
    }
})

watch(() => props.playbackRate, (r) => {
    if (nativeRef.value) nativeRef.value.playbackRate = r ?? 1.0
})

// ═════════════════════════════════════════════════════════════════════════
// AUTOPLAY IMPERATIVO PARA MOTOR NATIVO
// ─────────────────────────────────────────────────────────────────────────
// O atributo HTML `autoplay` só atua na montagem. Mudanças posteriores são
// ignoradas. Precisamos chamar .play() imperativamente quando a prop mudar.
// ═════════════════════════════════════════════════════════════════════════
watch(() => props.autoplay, async (shouldAutoplay) => {
    if (resolvedEngine.value !== 'native') return;
    if (props.previewOnly) return;
    await nextTick();
    const v = nativeRef.value;
    if (!v) return;

    if (shouldAutoplay) {
        try { await v.play(); } catch { /* política de autoplay */ }
    } else {
        try { v.pause(); } catch { }
    }
})

// ── Handlers ─────────────────────────────────────────────────────────────────
function onNativeError(e: Event) {
    const mode = (configStore.settings.videoEngine ?? 'smart') as EngineMode
    if (mode === 'smart' && resolvedEngine.value === 'native') {
        console.warn('[SmartVideo] nativo falhou — fallback para FFmpeg')
        resolvedEngine.value = 'ffmpeg'
    } else {
        emit('error', e)
    }
}

function onFFmpegError(e: any) {
    emit('error', e)
}

function onNativeMeta(e: Event) {
    const el = e.target as HTMLVideoElement
    if (el) {
        el.volume = props.volume ?? 1.0
        el.muted = !!(props.muted || props.noAudio)
        el.playbackRate = props.playbackRate ?? 1.0

        // ADICIONAR: se previewOnly, salta para o timestamp e pausa
        if (props.previewOnly) {
            el.currentTime = props.previewTimestamp ?? 0.5
            el.pause()
        }
    }
    emit('loadedmetadata', e)
}

// ═════════════════════════════════════════════════════════════════════════════
// HELPER: Lê valor de FFmpegVideo, que pode estar unwrapped OU como Ref
// ═════════════════════════════════════════════════════════════════════════════
// Vue `defineExpose` pode retornar valores unwrapped no template, mas como
// Refs quando acessado via `.value` em código. Para cobrir ambos os casos
// sem erro de TypeScript, fazemos cast `as any` e testamos .value.
//
function readFromFFmpeg(prop: string, fallback: any = 0): any {
    const f = ffmpegRef.value as any
    if (!f) return fallback
    const val = f[prop]
    if (val === undefined || val === null) return fallback
    // Se é um Ref (tem .value), usa .value; senão retorna direto
    if (typeof val === 'object' && 'value' in val) return val.value
    return val
}

// ═════════════════════════════════════════════════════════════════════════════
// API PÚBLICA — espelha HTMLVideoElement e FFmpegVideo
// ═════════════════════════════════════════════════════════════════════════════

async function play(): Promise<void> {
    if (resolvedEngine.value === 'native') {
        await nativeRef.value?.play().catch(() => {})
    } else if (resolvedEngine.value === 'ffmpeg') {
        await ffmpegRef.value?.play()
    }
}

function pause(): void {
    if (resolvedEngine.value === 'native') {
        nativeRef.value?.pause()
    } else if (resolvedEngine.value === 'ffmpeg') {
        ffmpegRef.value?.pause()
    }
}

function resume(): void {
    if (resolvedEngine.value === 'native') {
        nativeRef.value?.play().catch(() => {})
    } else if (resolvedEngine.value === 'ffmpeg') {
        ffmpegRef.value?.resume()
    }
}

async function seek(time: number): Promise<void> {

    if (!Number.isFinite(time)) return;

    if (resolvedEngine.value === 'native') {
        if (nativeRef.value) {
            try { nativeRef.value.currentTime = time } catch {}
        }
    } else if (resolvedEngine.value === 'ffmpeg') {
        await ffmpegRef.value?.seek(time)
    }
}

function setMuted(val: boolean): void {
    if (resolvedEngine.value === 'native') {
        if (nativeRef.value) {
            nativeRef.value.muted = val
            nativeRef.value.volume = val ? 0 : (props.volume ?? 1.0)
        }
    } else if (resolvedEngine.value === 'ffmpeg' && ffmpegRef.value) {
        // FFmpegVideo expõe muted como WritableComputedRef
        const f = ffmpegRef.value as any
        if (f.muted && typeof f.muted === 'object' && 'value' in f.muted) {
            f.muted.value = val
        }
    }
}

function setVolume(val: number): void {
    const v = Math.max(0, Math.min(1, val))
    if (resolvedEngine.value === 'native' && nativeRef.value) {
        nativeRef.value.volume = v
        if (v > 0) nativeRef.value.muted = false
    } else if (resolvedEngine.value === 'ffmpeg' && ffmpegRef.value) {
        const f = ffmpegRef.value as any
        if (f.volume && typeof f.volume === 'object' && 'value' in f.volume) {
            f.volume.value = v
        }
    }
}

// ─── Propriedades reativas (computed com helper robusto) ──────────────────────
const currentTime = computed<number>({
    get() {
        if (resolvedEngine.value === 'native') {
            return nativeRef.value?.currentTime ?? 0
        }
        return readFromFFmpeg('currentTime', 0)
    },
    set(v: number) {
        seek(v)
    }
})

const duration = computed<number>(() => {
    if (resolvedEngine.value === 'native') {
        const d = nativeRef.value?.duration
        return (d && isFinite(d)) ? d : 0
    }
    return readFromFFmpeg('duration', 0)
})

const paused = computed<boolean>(() => {
    if (resolvedEngine.value === 'native') {
        return nativeRef.value?.paused ?? true
    }
    return readFromFFmpeg('paused', true)
})

const ended = computed<boolean>(() => {
    if (resolvedEngine.value === 'native') {
        return nativeRef.value?.ended ?? false
    }
    return readFromFFmpeg('ended', false)
})

const videoWidth = computed<number>(() => {
    if (resolvedEngine.value === 'native') {
        return nativeRef.value?.videoWidth ?? 0
    }
    return readFromFFmpeg('videoWidth', 0)
})

const videoHeight = computed<number>(() => {
    if (resolvedEngine.value === 'native') {
        return nativeRef.value?.videoHeight ?? 0
    }
    return readFromFFmpeg('videoHeight', 0)
})

// ═════════════════════════════════════════════════════════════════════════════
// defineExpose
// ═════════════════════════════════════════════════════════════════════════════
// Acesso via ref pelo pai:
//
//   const videoRef = ref<InstanceType<typeof SmartVideo> | null>(null)
//   videoRef.value?.play()
//   videoRef.value?.seek(30)
//   videoRef.value?.currentTime = 30       // ← funciona: computed writable
//   const t = videoRef.value?.currentTime  // ← funciona: retorna number
//
// ATENÇÃO: quando acessado via `.value` (porque é ref), o Vue unwrappa
// automaticamente os computeds. Então `videoRef.value.currentTime` JÁ É
// o número (não um Ref). Para writable, a atribuição direta funciona.
//

defineExpose({
    // Ações
    play,
    pause,
    resume,
    seek,
    setMuted,
    setVolume,
    // Estados reativos
    currentTime,
    duration,
    paused,
    ended,
    videoWidth,
    videoHeight,
    // Meta
    resolvedEngine,
    _nativeRef: nativeRef,
    _ffmpegRef: ffmpegRef
})
</script>

<style scoped>
.smart-video-wrap {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: black;
}

.smart-native-video {
    width: 100%;
    height: 100%;
    display: block;
    background: black;
}

.smart-detecting {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.6);
}
</style>