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
            v-bind="nativeAttrs"
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

        <!-- Loading / fallback indicator (só durante detecção) -->
        <div v-if="resolvedEngine === null" class="smart-detecting">
            <v-progress-circular indeterminate size="24" color="primary" />
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useConfigStore } from '../stores/useConfigStore'
import FFmpegVideo from '../../FFmpegVideo.vue'  // ajuste o path

// ── Tipos ────────────────────────────────────────────────────────────────────
type Engine = 'ffmpeg' | 'native'
type EngineMode = 'ffmpeg' | 'native' | 'hybrid' | 'smart'

// ── Props (espelha FFmpegVideo + <video> nativo) ─────────────────────────────
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

// ── Refs ─────────────────────────────────────────────────────────────────────
const ffmpegRef = ref<InstanceType<typeof FFmpegVideo> | null>(null)
const nativeRef = ref<HTMLVideoElement | null>(null)
const configStore = useConfigStore()

// ── Motor resolvido (null = detectando) ──────────────────────────────────────
const resolvedEngine = ref<Engine | null>(null)

// ═════════════════════════════════════════════════════════════════════════════
// CODECS COMPATÍVEIS COM WEBKIT/WEBVIEW2 NATIVO
// ─────────────────────────────────────────────────────────────────────────────
// Extensões que o <video> nativo suporta sem FFmpeg na maioria dos sistemas.
// .mp4 H.264+AAC é o caso raiz — funciona em todos os targets.
// .mov só funciona no macOS/Safari WebKit.
// ─────────────────────────────────────────────────────────────────────────────
const NATIVE_COMPATIBLE_EXTENSIONS = new Set([
    'mp4', 'm4v', 'webm', 'ogv',
])

// Extensões que SÓ funcionam via FFmpeg
const FFMPEG_ONLY_EXTENSIONS = new Set([
    'mkv', 'avi', 'flv', 'wmv', 'ts', 'mts',
    'mov',  // mov tem codecs variados; ffmpeg garante
    'prores', 'mxf',
])

function detectEngine(src: string): Engine {
    const mode = (configStore.settings.videoEngine ?? 'smart') as EngineMode

    switch (mode) {
        case 'ffmpeg':
            return 'ffmpeg'

        case 'native':
            return 'native'

        case 'hybrid':
        case 'smart': {
            // Extrai extensão
            const ext = src.split('?')[0].split('.').pop()?.toLowerCase() ?? ''
            if (FFMPEG_ONLY_EXTENSIONS.has(ext)) return 'ffmpeg'
            if (NATIVE_COMPATIBLE_EXTENSIONS.has(ext)) return 'native'
            // Extensão desconhecida: smart → tenta nativo, hybrid → ffmpeg
            return mode === 'smart' ? 'native' : 'ffmpeg'
        }
    }
}

// ── Resolve motor quando src muda ────────────────────────────────────────────
watch(() => props.src, (newSrc) => {
    if (!newSrc) { resolvedEngine.value = null; return }
    resolvedEngine.value = detectEngine(newSrc)
}, { immediate: true })

// ── Em modo 'smart': se nativo falhar, faz fallback para FFmpeg ───────────────
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

// ── Props para cada motor ─────────────────────────────────────────────────────
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
}))

const nativeAttrs = computed(() => {
    const style: Record<string, string> = {
        width: '100%',
        height: '100%',
        objectFit: props.objectFit === 'none' ? 'fill' : (props.objectFit ?? 'contain'),
    }
    return {
        src: props.src,
        autoplay: props.autoplay || undefined,
        muted: props.muted || props.noAudio || undefined,
        loop: props.loop || undefined,
        playsinline: true,
        style,
    }
})

// ── Sincroniza volume e playbackRate no nativo (não via attrs) ────────────────
watch([() => props.volume, () => props.muted], () => {
    if (!nativeRef.value) return
    nativeRef.value.volume = props.volume ?? 1.0
    nativeRef.value.muted = !!(props.muted || props.noAudio)
}, { immediate: false })

watch(() => props.playbackRate, (r) => {
    if (nativeRef.value) nativeRef.value.playbackRate = r ?? 1.0
})

// ── loadedmetadata do nativo — normaliza para mesmo formato do FFmpegVideo ───
function onNativeMeta(e: Event) {
    const el = e.target as HTMLVideoElement
    // Aplica volume que pode não estar refletido pelo attr
    if (el) {
        el.volume = props.volume ?? 1.0
        el.muted = !!(props.muted || props.noAudio)
        el.playbackRate = props.playbackRate ?? 1.0
    }
    emit('loadedmetadata', e)
}

// ═════════════════════════════════════════════════════════════════════════════
// API EXPOSTA (espelha FFmpegVideo para que LiveMediaController não mude)
// ═════════════════════════════════════════════════════════════════════════════

function getActiveEl() {
    return resolvedEngine.value === 'native'
        ? nativeRef.value
        : ffmpegRef.value
}

async function play(): Promise<void> {
    const el = getActiveEl()
    if (!el) return
    if (resolvedEngine.value === 'native') {
        await (el as HTMLVideoElement).play()
    } else {
        await (el as InstanceType<typeof FFmpegVideo>).play()
    }
}

function pause(): void {
    const el = getActiveEl()
    if (!el) return
    (el as any).pause()
}

function resume(): void {
    const el = getActiveEl()
    if (!el) return
    if (resolvedEngine.value === 'native') {
        (el as HTMLVideoElement).play().catch(() => {})
    } else {
        (el as InstanceType<typeof FFmpegVideo>).resume()
    }
}

async function seek(time: number): Promise<void> {
    const el = getActiveEl()
    if (!el) return
    if (resolvedEngine.value === 'native') {
        (el as HTMLVideoElement).currentTime = time
    } else {
        await (el as InstanceType<typeof FFmpegVideo>).seek(time)
    }
}

// currentTime get/set
const currentTime = {
    get() {
        const el = getActiveEl()
        if (!el) return 0
        if (resolvedEngine.value === 'native') return (el as HTMLVideoElement).currentTime
        return (el as InstanceType<typeof FFmpegVideo>).currentTime.value
    },
    set(v: number) {
        seek(v)
    }
}

const duration = {
    get() {
        const el = getActiveEl()
        if (!el) return 0
        if (resolvedEngine.value === 'native') return (el as HTMLVideoElement).duration || 0
        return (el as InstanceType<typeof FFmpegVideo>).duration.value
    }
}

const paused = {
    get() {
        const el = getActiveEl()
        if (!el) return true
        if (resolvedEngine.value === 'native') return (el as HTMLVideoElement).paused
        return (el as InstanceType<typeof FFmpegVideo>).paused.value
    }
}

defineExpose({ play, pause, resume, seek, currentTime, duration, paused, resolvedEngine })
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