// src/stream.rs
//
// v7 — Correções:
//   1. WS de vídeo NÃO derruba mais o socket em RecvError::Lagged.
//      (era a principal causa de "vídeo travado" ao mover a timeline:
//      rajadas de seek atrasavam o consumidor, o broadcast reportava
//      Lagged, o `while let Ok` encerrava o loop e o WebSocket morria
//      silenciosamente → frontend ficava 350ms+ reconectando).
//   2. Endpoint de áudio aceita `?o=<segundos>` para offset explícito —
//      permite ao frontend recarregar o stream em qualquer ponto após um
//      seek sem depender (e sem corrida) do estado `audio_offset` da sessão.
//      Com isso o áudio toca DIRETO do arquivo de vídeo original, sem
//      extração prévia de .m4a.

use futures_util::{SinkExt, StreamExt};
use once_cell::sync::Lazy;
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::broadcast;
use tokio_util::io::ReaderStream;
use warp::{http::Response, Filter};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Cria um Command já configurado para não abrir janela no Windows.
/// No macOS/Linux é equivalente a Command::new().
fn silent_cmd(bin: &PathBuf) -> Command {
    let mut cmd = Command::new(bin);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd
}

// =============================================================================
// TIPOS
// =============================================================================

#[derive(Deserialize, Debug, Clone)]
struct FrontendCmd {
    cmd: String,
    #[serde(default)]
    time: Option<f64>,
    #[serde(default)]
    rate: Option<f64>,
    #[serde(default)]
    enabled: Option<bool>,
    #[serde(default)]
    muted: Option<bool>,
    #[serde(default)]
    volume: Option<f64>,
}

#[derive(Debug, Clone)]
enum PipelineCmd {
    Pause,
    Resume,
    Seek(f64),
    SetRate(f64),
    Stop,
}

#[derive(Clone, Debug)]
struct MediaInfo {
    duration: f64,
    fps: f64,
    has_audio: bool,
    video_codec: String, // h264, hevc, prores, vp9, av1, etc.
    src_width: u32,
    src_height: u32,
}

struct Session {
    frame_tx: broadcast::Sender<Arc<Vec<u8>>>,
    cmd_tx: tokio::sync::mpsc::Sender<PipelineCmd>,
    path: String,
    ffmpeg: PathBuf,
    audio_offset: Arc<Mutex<f64>>,
    has_audio: bool,
}

// =============================================================================
// ESTADO GLOBAL
// =============================================================================

static SESSIONS: Lazy<Mutex<HashMap<String, Arc<Session>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

static SERVERS_UP: Lazy<Mutex<bool>> = Lazy::new(|| Mutex::new(false));

pub struct PipelineState;
impl Default for PipelineState {
    fn default() -> Self {
        Self
    }
}
impl PipelineState {
    pub fn new() -> Self {
        Self
    }
}

// =============================================================================
// HELPERS
// =============================================================================

fn ffmpeg_bin(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("app_local_data_dir: {}", e))?
        .join("bin");
    let exe = if cfg!(target_os = "windows") {
        dir.join("ffmpeg.exe")
    } else {
        dir.join("ffmpeg")
    };
    if !exe.exists() {
        return Err(format!("FFmpeg não encontrado: {:?}", exe));
    }
    Ok(exe)
}

fn ffprobe_bin(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("app_local_data_dir: {}", e))?
        .join("bin");
    let exe = if cfg!(target_os = "windows") {
        dir.join("ffprobe.exe")
    } else {
        dir.join("ffprobe")
    };
    if !exe.exists() {
        return Err(format!("ffprobe não encontrado: {:?}", exe));
    }
    Ok(exe)
}

async fn probe(ffprobe: &PathBuf, path: &str) -> MediaInfo {
    let out = silent_cmd(ffprobe)
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_streams",
            "-show_format",
            path,
        ])
        .output()
        .await;

    let mut info = MediaInfo {
        duration: 0.0,
        fps: 30.0,
        has_audio: false,
        video_codec: String::new(),
        src_width: 0,
        src_height: 0,
    };
    if let Ok(o) = out {
        if let Ok(text) = String::from_utf8(o.stdout) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(d) = v["format"]["duration"].as_str() {
                    info.duration = d.parse().unwrap_or(0.0);
                }
                if let Some(streams) = v["streams"].as_array() {
                    for s in streams {
                        match s["codec_type"].as_str().unwrap_or("") {
                            "video" => {
                                if let Some(r) = s["r_frame_rate"].as_str() {
                                    if let Some((n, d)) = r.split_once('/') {
                                        let n: f64 = n.parse().unwrap_or(30.0);
                                        let d: f64 = d.parse().unwrap_or(1.0);
                                        if d > 0.0 {
                                            info.fps = n / d;
                                        }
                                    }
                                }
                                if let Some(c) = s["codec_name"].as_str() {
                                    info.video_codec = c.to_string();
                                }
                                info.src_width = s["width"].as_u64().unwrap_or(0) as u32;
                                info.src_height = s["height"].as_u64().unwrap_or(0) as u32;
                            }
                            "audio" => info.has_audio = true,
                            _ => {}
                        }
                    }
                }
            }
        }
    }
    info
}

// =============================================================================
// COMANDOS TAURI
// =============================================================================

#[tauri::command]
pub async fn play_video(
    app: AppHandle,
    _state: State<'_, PipelineState>,
    session_id: String,
    path: String,
    width: u32,
    height: u32,
    no_audio: Option<bool>,
    loop_video: bool,
) -> Result<(), String> {
    stop_session(&session_id);

    let ffmpeg = ffmpeg_bin(&app)?;
    let ffprobe = ffprobe_bin(&app)?;

    println!("\n[Backend] play_video: {}", path);
    {
        let mut up = SERVERS_UP.lock().unwrap();
        if !*up {
            start_warp_servers();
            *up = true;
        }
    }

    let info = probe(&ffprobe, &path).await;
    let skip_audio = no_audio.unwrap_or(false) || !info.has_audio;

    println!(
        "[Backend] has_audio={}, skip_audio={}, codec={}, src={}x{}, dur={:.1}s",
        info.has_audio,
        skip_audio,
        info.video_codec,
        info.src_width,
        info.src_height,
        info.duration
    );

    // Buffer adaptativo: frames grandes → menos slots. Aumentado para dar
    // folga ao seletor "frame mais próximo" do frontend.
    let est_frame_size = (info.src_width.max(1280) * info.src_height.max(720)) as usize * 3 / 2;
    let buf_slots = if est_frame_size > 6_000_000 {
        8
    }
    // 4K+
    else if est_frame_size > 3_000_000 {
        16
    }
    // 1440p
    else {
        24
    }; // ≤1080p

    let (frame_tx, _) = broadcast::channel::<Arc<Vec<u8>>>(buf_slots);
    let (cmd_tx, cmd_rx) = tokio::sync::mpsc::channel::<PipelineCmd>(32);
    let audio_offset = Arc::new(Mutex::new(0.0f64));

    let sess = Arc::new(Session {
        frame_tx: frame_tx.clone(),
        cmd_tx: cmd_tx.clone(),
        path: path.clone(),
        ffmpeg: ffmpeg.clone(),
        audio_offset: audio_offset.clone(),
        has_audio: !skip_audio,
    });
    SESSIONS.lock().unwrap().insert(session_id.clone(), sess);

    tokio::spawn(frame_loop(
        session_id,
        path,
        width,
        height,
        loop_video,
        0.0,
        info,
        ffmpeg,
        frame_tx,
        cmd_rx,
        audio_offset,
    ));

    Ok(())
}

#[tauri::command]
pub fn stop_video(session_id: String) {
    stop_session(&session_id);
}

#[tauri::command]
pub async fn send_video_command(
    session_id: String,
    command: serde_json::Value,
) -> Result<(), String> {
    let fc: FrontendCmd = serde_json::from_value(command).map_err(|e| e.to_string())?;
    dispatch_cmd(&session_id, &fc);
    Ok(())
}

#[tauri::command]
pub async fn get_video_preview(
    app: AppHandle,
    path: String,
    timestamp: Option<f64>,
    width: Option<u32>,
    height: Option<u32>,
) -> Result<Vec<u8>, String> {
    let ffmpeg = ffmpeg_bin(&app)?;
    let ts = timestamp.unwrap_or(0.0);

    let mut args = vec![
        "-ss".to_string(),
        format!("{:.3}", ts),
        "-i".to_string(),
        path,
        "-vframes".to_string(),
        "1".to_string(),
    ];

    if let (Some(w), Some(h)) = (width, height) {
        args.extend(["-vf".to_string(), format!("scale={}:{}", w, h)]);
    } else if let Some(w) = width {
        args.extend(["-vf".to_string(), format!("scale={}:-2", w)]);
    } else if let Some(h) = height {
        args.extend(["-vf".to_string(), format!("scale=-2:{}", h)]);
    }

    args.extend([
        "-f".to_string(),
        "image2pipe".to_string(),
        "-vcodec".to_string(),
        "mjpeg".to_string(),
        "-q:v".to_string(),
        "3".to_string(),
        "-".to_string(),
    ]);

    let out = silent_cmd(&ffmpeg)
        .args(&args)
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(out.stdout)
    } else {
        Err(String::from_utf8_lossy(&out.stderr).to_string())
    }
}

#[tauri::command]
pub async fn get_video_info(app: AppHandle, path: String) -> Result<serde_json::Value, String> {
    let ffprobe = ffprobe_bin(&app)?;
    let info = probe(&ffprobe, &path).await;

    Ok(json!({
        "duration":  info.duration,
        "fps":       info.fps,
        "has_audio": info.has_audio,
        "width":     info.src_width,
        "height":    info.src_height,
        "codec":     info.video_codec,
    }))
}

// =============================================================================
// FRAME LOOP
// =============================================================================

async fn frame_loop(
    session_id: String,
    path: String,
    width: u32,
    height: u32,
    loop_video: bool,
    mut seek: f64,
    info: MediaInfo,
    ffmpeg: PathBuf,
    frame_tx: broadcast::Sender<Arc<Vec<u8>>>,
    mut cmd_rx: tokio::sync::mpsc::Receiver<PipelineCmd>,
    audio_offset: Arc<Mutex<f64>>,
) {
    // ── Limite de resolução adaptativo ──────────────────────────────────────
    //
    // Regra: qualquer vídeo acima de 1920 de largura cai para 1920. Isso
    // porque o render destino é uma janela (não um monitor 4K nativo) e
    // decodificar 4K para depois scale para 1080 visual é desperdício.
    //
    // Para codecs pesados de decode (HEVC, AV1) com resolução alta, cair
    // mais ainda ajuda porque o bottleneck é o decoder, não o scale.
    //
    let codec_hint = info.video_codec.as_str();
    let max_w: u32 = match codec_hint {
        // HEVC/AV1 em 4K são muito pesados — 1280 dá folga
        "hevc" | "av1" if info.src_width > 2560 => 1280,
        // ProRes/intraframe pesados em 4K
        "prores" | "ffv1" | "huffyuv" | "dnxhd" | "mjpeg" if info.src_width > 2560 => 1280,
        // Demais: limita a 1920 (FullHD)
        _ => 1920,
    };

    // ── Cálculo de tamanho FINAL preservando aspect ratio ─────────────────
    //
    // `width` e `height` recebidos do frontend são tratados como uma
    // CAIXA MÁXIMA (max_w × max_h), não dimensões exatas. O tamanho real
    // de decode respeita o aspect ratio do vídeo original (`info.src_width`
    // × `info.src_height`), cabendo dentro dessa caixa.
    //
    // Isso garante que o frame chegue ao canvas COM SEU RATIO ORIGINAL,
    // deixando para o WebGL aplicar `objectFit` (contain/cover/fill).
    //
    let src_w = info.src_width.max(1);
    let src_h = info.src_height.max(1);
    let box_w = width.min(max_w).max(2);
    let box_h = height.min(max_w).max(2); // usa max_w como limite geral

    // Escala o vídeo para caber na caixa, preservando aspect ratio
    let src_ratio = src_w as f64 / src_h as f64;
    let box_ratio = box_w as f64 / box_h as f64;

    let (w, h) = if src_ratio > box_ratio {
        // Vídeo mais largo que a caixa — limita pela largura
        let fit_w = box_w.min(src_w);
        let fit_h = ((fit_w as f64 / src_ratio).round() as u32).max(2);
        ((fit_w / 2) * 2, (fit_h / 2) * 2)
    } else {
        // Vídeo mais alto/quadrado — limita pela altura
        let fit_h = box_h.min(src_h);
        let fit_w = ((fit_h as f64 * src_ratio).round() as u32).max(2);
        ((fit_w / 2) * 2, (fit_h / 2) * 2)
    };

    // Garante que não exceda max_w em nenhuma dimensão
    let (w, h) = if w > max_w {
        let ratio = max_w as f64 / w as f64;
        (
            ((max_w / 2) * 2),
            (((h as f64 * ratio) as u32 / 2) * 2).max(2),
        )
    } else {
        (w, h)
    };

    let y_size = (w * h) as usize;
    let uv_size = ((w / 2) * (h / 2)) as usize;
    let frame_size = y_size + uv_size * 2;

    let fps = info.fps.max(1.0);
    let duration = info.duration;

    let mut loop_count: u64 = 0;
    let mut paused: bool = false;
    let mut rate: f64 = 1.0;

    'outer: loop {
        let mut args: Vec<String> = Vec::new();

        let codec = info.video_codec.as_str();
        let is_intraframe = matches!(
            codec,
            "prores" | "ffv1" | "huffyuv" | "mjpeg" | "rawvideo" | "dnxhd"
        );

        // Detecta se precisa fazer downscale significativo
        let src_w = info.src_width;
        let src_h = info.src_height;
        let needs_downscale = src_w > 0 && w < src_w && (src_w - w) > 100;

        #[cfg(target_os = "windows")]
        {
            if is_intraframe {
                args.extend(["-threads".into(), "0".into()]);
            } else if needs_downscale && matches!(codec, "h264" | "hevc") {
                // ─── ESTRATÉGIA CHAVE PARA 4K → 1080p ───
                //
                // Scale no decoder D3D11VA usando hwaccel_output_format +
                // scale_cuda/scale_qsv é complicado de configurar em todos
                // os builds de FFmpeg. A solução robusta é:
                //
                // 1. Usar -noautorotate e -fflags +fastseek (evita análise)
                // 2. Deixar o FFmpeg decodar em software com múltiplas threads
                //    (H.264 software 4K @ 30fps é ~20% CPU moderno)
                // 3. Scale em software com bilinear rápido
                //
                // Isso É PIOR em CPU mas MUITO melhor em GPU total (remove
                // o overhead de transferência GPU↔CPU que estava causando
                // 35-50% de uso).
                //
                args.extend(["-threads".into(), "0".into()]);
                args.extend(["-fflags".into(), "+fastseek".into()]);
            } else {
                // Não precisa scale (vídeo já na resolução alvo): hwaccel puro
                args.extend(["-hwaccel".into(), "auto".into()]);
                args.extend(["-threads".into(), "4".into()]);
            }
        }

        #[cfg(target_os = "macos")]
        {
            // VideoToolbox no macOS tem scale integrado — hwaccel sempre vale
            if is_intraframe {
                args.extend(["-threads".into(), "0".into()]);
            } else {
                args.extend(["-hwaccel".into(), "videotoolbox".into()]);
                args.extend(["-threads".into(), "4".into()]);
            }
        }

        #[cfg(all(
            target_os = "linux",
            not(any(target_os = "windows", target_os = "macos"))
        ))]
        {
            if is_intraframe || needs_downscale {
                args.extend(["-threads".into(), "0".into()]);
            } else {
                args.extend(["-hwaccel".into(), "auto".into()]);
                args.extend(["-threads".into(), "4".into()]);
            }
        }

        if loop_video {
            args.extend(["-stream_loop".into(), "-1".into()]);
        }
        if seek > 0.0 {
            args.extend(["-ss".into(), format!("{:.3}", seek)]);
        }

        // ── Scale filter ───────────────────────────────────────────────────
        let same_size = src_w > 0
            && src_h > 0
            && (src_w as i32 - w as i32).abs() < 4
            && (src_h as i32 - h as i32).abs() < 4;

        let vf = if same_size {
            "format=yuv420p".to_string()
        } else {
            // fast_bilinear é a flag mais rápida para downscale.
            // ~2× mais rápido que bicubic e visualmente idêntico em downscale.
            format!("scale={}:{}:flags=fast_bilinear,format=yuv420p", w, h)
        };

        args.extend([
            "-i".into(),
            path.clone(),
            "-vf".into(),
            vf,
            "-f".into(),
            "rawvideo".into(),
            "-pix_fmt".into(),
            "yuv420p".into(),
            "-an".into(),
            "-sn".into(),
            "-loglevel".into(),
            "error".into(),
            "pipe:1".into(),
        ]);

        let mut child = match silent_cmd(&ffmpeg)
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[frame_loop {}] spawn: {}", session_id, e);
                break;
            }
        };

        if let Some(stderr) = child.stderr.take() {
            let sid = session_id.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr);
                let mut line = String::new();
                while reader.read_line(&mut line).await.unwrap_or(0) > 0 {
                    eprint!("[FFmpeg {}] {}", sid, line);
                    line.clear();
                }
            });
        }

        let raw_stdout = child.stdout.take().unwrap();
        let mut stdout = BufReader::with_capacity(frame_size * 2, raw_stdout);
        let mut frame_buf = vec![0u8; frame_size];
        let mut frame_idx: u64 = 0;

        let frames_per_pass: u64 = if fps > 0.0 && duration > 0.0 {
            (duration * fps).round() as u64
        } else {
            u64::MAX
        };

        let mut pipeline_start = tokio::time::Instant::now();
        let mut frames_emitted: u64 = 0;

        'read: loop {
            // ── COALESCING DE SEEKS ──
            // Drena TODOS os comandos pendentes antes de agir. Se houver
            // múltiplos Seek na fila, apenas o ÚLTIMO é aplicado — os
            // anteriores são descartados. Isso evita thrashing do FFmpeg
            // quando o frontend envia seeks em rajada.
            let mut pending_seek: Option<f64> = None;
            let mut should_break_outer = false;
            let mut new_rate: Option<f64> = None;

            loop {
                match cmd_rx.try_recv() {
                    Ok(PipelineCmd::Stop) => {
                        should_break_outer = true;
                        break;
                    }
                    Ok(PipelineCmd::Pause) => paused = true,
                    Ok(PipelineCmd::Resume) => {
                        paused = false;
                        pipeline_start = tokio::time::Instant::now();
                        frames_emitted = 0;
                    }
                    Ok(PipelineCmd::SetRate(r)) => {
                        new_rate = Some(r.clamp(0.25, 4.0));
                    }
                    Ok(PipelineCmd::Seek(t)) => {
                        // Acumula — se vier outro Seek, este é ignorado
                        pending_seek = Some(t);
                    }
                    Err(tokio::sync::mpsc::error::TryRecvError::Disconnected) => {
                        should_break_outer = true;
                        break;
                    }
                    Err(_) => break, // fila vazia
                }
            }

            if should_break_outer {
                break 'outer;
            }

            if let Some(r) = new_rate {
                rate = r;
                pipeline_start = tokio::time::Instant::now();
                frames_emitted = 0;
            }

            // Aplica APENAS o último seek acumulado
            if let Some(t) = pending_seek {
                let _ = child.kill().await;
                seek = t;
                loop_count = 0;
                paused = false;
                *audio_offset.lock().unwrap() = t;
                continue 'outer;
            }

            if paused {
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                continue;
            }

            match stdout.read_exact(&mut frame_buf).await {
                Ok(_) => {
                    frame_idx += 1;

                    let (frame_in_pass, is_restart) = if loop_video && frames_per_pass < u64::MAX {
                        let f = frame_idx % frames_per_pass;
                        let r = f == 0 && frame_idx > 0;
                        if r {
                            loop_count += 1;
                        }
                        (if f == 0 { frames_per_pass } else { f }, r)
                    } else {
                        (frame_idx, false)
                    };

                    let pts = if loop_video && frames_per_pass < u64::MAX {
                        (loop_count * frames_per_pass + frame_in_pass) as f64 / fps + seek
                    } else {
                        frame_idx as f64 / fps + seek
                    };

                    if is_restart {
                        pipeline_start = tokio::time::Instant::now();
                        frames_emitted = 0;
                    }

                    let meta = json!({
                        "pts": pts, "duration": duration,
                        "video_width": w, "video_height": h,
                        "fps": fps, "has_audio": info.has_audio,
                        "loop_restart": is_restart,
                    });

                    let meta_bytes = meta.to_string();
                    let total = meta_bytes.len() + 1 + frame_size;
                    let mut pkt = Vec::with_capacity(total);
                    pkt.extend_from_slice(meta_bytes.as_bytes());
                    pkt.push(b'|');
                    pkt.extend_from_slice(&frame_buf);

                    let _ = frame_tx.send(Arc::new(pkt));

                    frames_emitted += 1;
                    let expected_ns =
                        (frames_emitted as f64 * 1_000_000_000.0 / (fps * rate)) as u64;
                    let elapsed_ns = pipeline_start.elapsed().as_nanos() as u64;
                    if expected_ns > elapsed_ns {
                        let sleep_ns = (expected_ns - elapsed_ns).min(200_000_000);
                        tokio::time::sleep(std::time::Duration::from_nanos(sleep_ns)).await;
                    }
                }
                Err(e) => {
                    if e.kind() != std::io::ErrorKind::UnexpectedEof {
                        eprintln!("[frame_loop {}] leitura: {}", session_id, e);
                    } else {
                        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                    }
                    break 'read;
                }
            }
        }

        let _ = child.kill().await;

        if loop_video {
            loop_count += 1;
            seek = 0.0;
            continue 'outer;
        } else {
            break 'outer;
        }
    }

    SESSIONS.lock().unwrap().remove(&session_id);
    eprintln!("[frame_loop {}] encerrado.", session_id);
}

// =============================================================================
// SERVIDORES WARP
// =============================================================================
//
// ÁUDIO: o endpoint transcodifica o áudio do PRÓPRIO arquivo de vídeo em
// tempo real — não precisa mais de extração prévia (.m4a). O offset inicial
// pode vir de duas fontes, nesta ordem de prioridade:
//
//   1. Query param `?o=<segundos>` (frontend recarrega o stream após seek)
//   2. `audio_offset` da sessão (atualizado pelo pipeline em cada Seek)
//

/// Gera args do FFmpeg para formato de áudio específico.
/// Retorna (args, content_type).
fn audio_args(vpath: &str, offset: f64, format: &str) -> (Vec<String>, &'static str) {
    let mut args: Vec<String> = Vec::new();
    if offset > 0.0 {
        args.extend(["-ss".into(), format!("{:.3}", offset)]);
    }
    args.extend(["-i".into(), vpath.into(), "-vn".into()]);

    let content_type = match format {
        // ── MP3 — compatibilidade máxima com <audio> direto ──
        // WKWebView + WebView2 sempre aceitam MP3. Não é streaming MP4
        // fragmentado, é MP3 stream puro (Icecast-like).
        "mp3" => {
            args.extend([
                "-acodec".into(),
                "libmp3lame".into(),
                "-b:a".into(),
                "192k".into(),
                "-ac".into(),
                "2".into(),
                "-ar".into(),
                "44100".into(),
                "-f".into(),
                "mp3".into(),
                // Sem cabeçalho Xing/Info — reduz atraso e engano de duração
                "-write_xing".into(),
                "0".into(),
                "-loglevel".into(),
                "error".into(),
                "pipe:1".into(),
            ]);
            "audio/mpeg"
        }
        // ── OGG Vorbis — alternativa livre de royalties ──
        "ogg" => {
            args.extend([
                "-acodec".into(),
                "libvorbis".into(),
                "-b:a".into(),
                "192k".into(),
                "-ac".into(),
                "2".into(),
                "-ar".into(),
                "44100".into(),
                "-f".into(),
                "ogg".into(),
                "-loglevel".into(),
                "error".into(),
                "pipe:1".into(),
            ]);
            "audio/ogg"
        }
        // ── WAV — sem compressão, funciona sempre mas pesado ──
        "wav" => {
            args.extend([
                "-acodec".into(),
                "pcm_s16le".into(),
                "-ac".into(),
                "2".into(),
                "-ar".into(),
                "44100".into(),
                "-f".into(),
                "wav".into(),
                "-loglevel".into(),
                "error".into(),
                "pipe:1".into(),
            ]);
            "audio/wav"
        }
        // ── fMP4 AAC (default) ──
        _ => {
            args.extend([
                "-acodec".into(),
                "aac".into(),
                "-profile:a".into(),
                "aac_low".into(),
                "-b:a".into(),
                "128k".into(),
                "-ac".into(),
                "2".into(),
                "-ar".into(),
                "44100".into(),
                "-f".into(),
                "mp4".into(),
                // fMP4 para MSE: moov vazio no início + moof por fragmento
                // com offsets relativos. `faststart` foi REMOVIDO — exige
                // saída seekable e não se aplica a pipe.
                "-movflags".into(),
                "empty_moov+default_base_moof+frag_keyframe".into(),
                // Fragmentos de 200ms → áudio começa rápido após play/seek
                "-frag_duration".into(),
                "200000".into(),
                "-loglevel".into(),
                "error".into(),
                "pipe:1".into(),
            ]);
            "audio/mp4"
        }
    };
    (args, content_type)
}

fn start_warp_servers() {
    // ── 9001 — WS vídeo ───────────────────────────────────────────────────
    let video_ws =
        warp::path::param::<String>()
            .and(warp::ws())
            .map(|sid: String, ws: warp::ws::Ws| {
                ws.on_upgrade(move |socket| async move {
                    let rx = {
                        let map = SESSIONS.lock().unwrap();
                        map.get(&sid).map(|s| s.frame_tx.subscribe())
                    };
                    let mut rx = match rx {
                        Some(r) => r,
                        None => return,
                    };
                    let (mut sink, _) = socket.split();

                    // ─── CORREÇÃO CRÍTICA (travadas no seek) ───
                    //
                    // O `while let Ok(pkt) = rx.recv()` anterior ENCERRAVA o
                    // loop quando o broadcast retornava Err(Lagged) — que é
                    // exatamente o que acontece quando o consumidor atrasa
                    // durante rajadas de seek. O WebSocket morria em silêncio
                    // e o frontend ficava 350ms+ reconectando (ou esgotava
                    // as tentativas). Lagged NÃO é fatal: apenas pula os
                    // frames perdidos e continua no mais recente.
                    //
                    loop {
                        match rx.recv().await {
                            Ok(pkt) => {
                                if sink
                                    .send(warp::ws::Message::binary((*pkt).clone()))
                                    .await
                                    .is_err()
                                {
                                    break;
                                }
                            }
                            Err(broadcast::error::RecvError::Lagged(n)) => {
                                eprintln!("[video_ws {}] lagged {} frames — continuando", sid, n);
                                continue;
                            }
                            Err(broadcast::error::RecvError::Closed) => break,
                        }
                    }
                })
            });

    // ── 9002 — HTTP áudio em múltiplos formatos ────────────────────────────
    //
    // Rotas disponíveis:
    //   GET /{sid}/stream.mp3[?o=SEC]  → audio/mpeg  (máxima compatibilidade)
    //   GET /{sid}/stream.mp4[?o=SEC]  → audio/mp4   (fMP4 + AAC)
    //   GET /{sid}/stream.ogg[?o=SEC]  → audio/ogg   (Vorbis)
    //   GET /{sid}/stream.wav[?o=SEC]  → audio/wav   (PCM, sem compressão)
    //
    // `o` = offset em segundos: o FFmpeg abre o arquivo com -ss nesse ponto.
    //

    fn build_audio_handler(
        format: &'static str,
    ) -> impl Filter<Extract = (Response<warp::hyper::Body>,), Error = warp::Rejection> + Clone
    {
        let ext = match format {
            "mp3" => "stream.mp3",
            "ogg" => "stream.ogg",
            "wav" => "stream.wav",
            _ => "stream.mp4",
        };
        warp::path::param::<String>()
            .and(warp::path(ext))
            .and(warp::path::end())
            .and(warp::get())
            .and(warp::query::<HashMap<String, String>>())
            .and_then(move |sid: String, q: HashMap<String, String>| {
                let fmt = format;
                async move {
                    println!("[audio] GET /{}/stream.{} q={:?}", sid, fmt, q);
                    let (ffmpeg, vpath, session_offset, has_audio) = {
                        let map = SESSIONS.lock().unwrap();
                        match map.get(&sid) {
                            Some(s) => (
                                s.ffmpeg.clone(),
                                s.path.clone(),
                                *s.audio_offset.lock().unwrap(),
                                s.has_audio,
                            ),
                            None => {
                                return Ok::<_, warp::Rejection>(
                                    Response::builder()
                                        .status(404)
                                        .header("Access-Control-Allow-Origin", "*")
                                        .body(warp::hyper::Body::empty())
                                        .unwrap(),
                                );
                            }
                        }
                    };

                    if !has_audio || vpath.is_empty() || !ffmpeg.exists() {
                        return Ok::<_, warp::Rejection>(
                            Response::builder()
                                .status(204)
                                .header("Access-Control-Allow-Origin", "*")
                                .body(warp::hyper::Body::empty())
                                .unwrap(),
                        );
                    }

                    // Offset explícito do frontend tem prioridade sobre o
                    // estado da sessão (elimina corrida seek ↔ GET de áudio)
                    let offset = q
                        .get("o")
                        .and_then(|s| s.parse::<f64>().ok())
                        .filter(|v| v.is_finite() && *v >= 0.0)
                        .unwrap_or(session_offset);

                    let (args, content_type) = audio_args(&vpath, offset, fmt);
                    println!(
                        "[audio] spawn ffmpeg fmt={} ct={} offset={:.3}",
                        fmt, content_type, offset
                    );

                    let mut child = match silent_cmd(&ffmpeg)
                        .args(&args)
                        .stdout(Stdio::piped())
                        .stderr(Stdio::piped())
                        .kill_on_drop(true)
                        .spawn()
                    {
                        Ok(c) => c,
                        Err(e) => {
                            eprintln!("[audio] spawn failed: {}", e);
                            return Ok::<_, warp::Rejection>(
                                Response::builder()
                                    .status(500)
                                    .header("Access-Control-Allow-Origin", "*")
                                    .body(warp::hyper::Body::empty())
                                    .unwrap(),
                            );
                        }
                    };

                    if let Some(stderr) = child.stderr.take() {
                        let sid2 = sid.clone();
                        let fmt2 = fmt.to_string();
                        tokio::spawn(async move {
                            let mut reader = BufReader::new(stderr);
                            let mut line = String::new();
                            while reader.read_line(&mut line).await.unwrap_or(0) > 0 {
                                eprint!("[FFmpeg audio {} fmt={}] {}", sid2, fmt2, line);
                                line.clear();
                            }
                        });
                    }

                    let stdout = child.stdout.take().unwrap();
                    let stream = ReaderStream::new(stdout);
                    let body = warp::hyper::Body::wrap_stream(stream);

                    Ok::<_, warp::Rejection>(
                        Response::builder()
                            .status(200)
                            .header("Content-Type", content_type)
                            .header("Cache-Control", "no-cache, no-store, must-revalidate")
                            .header("Pragma", "no-cache")
                            .header("Access-Control-Allow-Origin", "*")
                            .header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
                            .header("Access-Control-Allow-Headers", "*")
                            .header(
                                "Access-Control-Expose-Headers",
                                "Content-Type, Content-Length",
                            )
                            .body(body)
                            .unwrap(),
                    )
                }
            })
    }

    let audio_mp4 = build_audio_handler("mp4");
    let audio_mp3 = build_audio_handler("mp3");
    let audio_ogg = build_audio_handler("ogg");
    let audio_wav = build_audio_handler("wav");

    // HEAD genérico para probe — responde para qualquer formato
    let audio_head = warp::path::param::<String>()
        .and(warp::path::param::<String>()) // stream.mp3, stream.mp4, etc
        .and(warp::path::end())
        .and(warp::head())
        .map(|sid: String, _file: String| {
            let has_audio = {
                let map = SESSIONS.lock().unwrap();
                map.get(&sid).map(|s| s.has_audio).unwrap_or(false)
            };
            let status = if has_audio { 200 } else { 204 };
            Response::builder()
                .status(status)
                .header("Access-Control-Allow-Origin", "*")
                .body(warp::hyper::Body::empty())
                .unwrap()
        });

    let audio_options = warp::path::param::<String>()
        .and(warp::path::param::<String>())
        .and(warp::path::end())
        .and(warp::options())
        .map(|_sid: String, _file: String| {
            Response::builder()
                .status(204)
                .header("Access-Control-Allow-Origin", "*")
                .header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
                .header("Access-Control-Allow-Headers", "*")
                .body(warp::hyper::Body::empty())
                .unwrap()
        });

    // ── 9003 — WS controle ────────────────────────────────────────────────
    let ctrl_ws =
        warp::path::param::<String>()
            .and(warp::ws())
            .map(|sid: String, ws: warp::ws::Ws| {
                ws.on_upgrade(move |socket| async move {
                    let (mut sink, mut stream) = socket.split();
                    while let Some(Ok(msg)) = stream.next().await {
                        if !msg.is_text() {
                            continue;
                        }
                        let text = match msg.to_str() {
                            Ok(t) => t,
                            Err(_) => continue,
                        };
                        if let Ok(cmd) = serde_json::from_str::<FrontendCmd>(text) {
                            dispatch_cmd(&sid, &cmd);
                        }
                        let _ = sink.send(warp::ws::Message::text(r#"{"ok":true}"#)).await;
                    }
                })
            });

    tokio::spawn(async move {
        warp::serve(video_ws).run(([127, 0, 0, 1], 9001)).await;
    });
    tokio::spawn(async move {
        warp::serve(
            audio_options
                .or(audio_head)
                .or(audio_mp3)
                .or(audio_mp4)
                .or(audio_ogg)
                .or(audio_wav),
        )
        .run(([127, 0, 0, 1], 9002))
        .await;
    });
    tokio::spawn(async move {
        warp::serve(ctrl_ws).run(([127, 0, 0, 1], 9003)).await;
    });

    eprintln!("[stream] Servidores 9001/9002/9003 iniciados.");
}

// =============================================================================
// HELPERS INTERNOS
// =============================================================================

fn stop_session(session_id: &str) {
    let sess = SESSIONS.lock().unwrap().remove(session_id);
    if let Some(s) = sess {
        let _ = s.cmd_tx.try_send(PipelineCmd::Stop);
    }
}

fn dispatch_cmd(session_id: &str, fc: &FrontendCmd) {
    let maybe_cmd: Option<PipelineCmd> = match fc.cmd.as_str() {
        "pause" => Some(PipelineCmd::Pause),
        "play" => Some(PipelineCmd::Resume),
        "seek" => fc.time.map(PipelineCmd::Seek),
        "set_rate" => fc.rate.map(|r| PipelineCmd::SetRate(r.clamp(0.25, 4.0))),
        "set_loop" => fc.enabled.map(|_| PipelineCmd::Resume),
        "set_muted" => None,
        "set_volume" => None,
        _ => None,
    };

    if let Some(cmd) = maybe_cmd {
        let tx = {
            let map = SESSIONS.lock().unwrap();
            map.get(session_id).map(|s| s.cmd_tx.clone())
        };
        if let Some(tx) = tx {
            let _ = tx.try_send(cmd);
        }
    }
}

// =============================================================================
// EXTRAÇÃO DE ÁUDIO SOB DEMANDA (com cache)
// =============================================================================
//
// Chamado pelo frontend antes de tocar. Comportamento:
//   - Vídeo sem trilha de áudio      → Ok(None)   (sem erro, sem arquivo)
//   - .m4a já existe ao lado do vídeo → Ok(Some(caminho))  (instantâneo)
//   - Caso contrário: extrai (copy → fallback AAC) para um .part e renomeia
//     no final — nunca deixa um .m4a parcial que enganaria o cache.
//

#[tauri::command]
pub async fn ensure_audio_extracted(
    app: AppHandle,
    video_path: String,
) -> Result<Option<String>, String> {
    let ffprobe = ffprobe_bin(&app)?;
    let info = probe(&ffprobe, &video_path).await;
    if !info.has_audio {
        println!("[ensure_audio] sem trilha de áudio: {}", video_path);
        return Ok(None);
    }

    let vp = std::path::Path::new(&video_path);
    let audio_path = vp.with_extension("m4a");
    let audio_str = audio_path.to_string_lossy().to_string();

    // Cache: já extraído (e não vazio/corrompido de tentativa abortada)
    if std::fs::metadata(&audio_path)
        .map(|m| m.len() > 0)
        .unwrap_or(false)
    {
        return Ok(Some(audio_str));
    }

    let ffmpeg = ffmpeg_bin(&app)?;
    let tmp = vp.with_extension("m4a.part");
    let tmp_str = tmp.to_string_lossy().to_string();

    // ── Tentativa 1: copy direto (rápido, sem re-encode — funciona p/ AAC) ──
    // `-f ipod` é obrigatório: a extensão .part não permite inferir o muxer.
    let copy_result = silent_cmd(&ffmpeg)
        .args([
            "-i", &video_path, "-vn", "-c:a", "copy",
            "-movflags", "+faststart", "-f", "ipod", "-y", &tmp_str,
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let ok = if copy_result.status.success() {
        println!("[ensure_audio] copy OK: {}", audio_str);
        true
    } else {
        // ── Tentativa 2: re-encode AAC (Opus, Vorbis, FLAC, WMA, etc.) ──
        let enc = silent_cmd(&ffmpeg)
            .args([
                "-i", &video_path, "-vn", "-c:a", "aac", "-b:a", "192k",
                "-ac", "2", "-ar", "44100",
                "-movflags", "+faststart", "-f", "ipod", "-y", &tmp_str,
            ])
            .output()
            .await
            .map_err(|e| e.to_string())?;
        if enc.status.success() {
            println!("[ensure_audio] re-encode AAC OK: {}", audio_str);
            true
        } else {
            let stderr = String::from_utf8_lossy(&enc.stderr);
            eprintln!("[ensure_audio] falhou:\n{}", stderr);
            let _ = std::fs::remove_file(&tmp);
            return Err(format!(
                "Falha ao extrair áudio: {}",
                stderr.lines().take(3).collect::<Vec<_>>().join(" | ")
            ));
        }
    };

    if ok {
        std::fs::rename(&tmp, &audio_path).map_err(|e| e.to_string())?;
    }
    Ok(Some(audio_str))
}

// =============================================================================
// EXTRAÇÃO DE ÁUDIO LOCAL (mantido para compatibilidade — NÃO é mais
// necessário para reprodução: o áudio agora vem via streaming da porta 9002)
// =============================================================================

#[tauri::command]
pub async fn extract_audio_local(
    app: AppHandle,
    video_path: String,
    audio_path: String,
) -> Result<(), String> {
    let ffmpeg = ffmpeg_bin(&app)?;

    // ── Tentativa 1: copy direto (rápido) ──
    let copy_result = silent_cmd(&ffmpeg)
        .args(["-i", &video_path, "-vn", "-c:a", "copy", "-y", &audio_path])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if copy_result.status.success() {
        println!("[extract_audio] copy OK: {}", audio_path);
        return Ok(());
    }

    let copy_stderr = String::from_utf8_lossy(&copy_result.stderr);
    println!(
        "[extract_audio] copy falhou — tentando re-encode. Motivo:\n{}",
        copy_stderr.lines().take(3).collect::<Vec<_>>().join(" | ")
    );

    // ── Tentativa 2: re-encode para AAC (universal) ──
    let encode_result = silent_cmd(&ffmpeg)
        .args([
            "-i",
            &video_path,
            "-vn",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ac",
            "2",
            "-ar",
            "44100",
            "-y",
            &audio_path,
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if encode_result.status.success() {
        println!("[extract_audio] re-encode AAC OK: {}", audio_path);
        return Ok(());
    }

    let encode_stderr = String::from_utf8_lossy(&encode_result.stderr);
    eprintln!("[extract_audio] re-encode falhou:\n{}", encode_stderr);

    // ── Diagnóstico: verifica se o arquivo tem mesmo uma trilha de áudio ──
    let ffprobe = ffprobe_bin(&app)?;
    let probe_result = silent_cmd(&ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=codec_name",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            &video_path,
        ])
        .output()
        .await
        .ok();

    let audio_codec = probe_result
        .as_ref()
        .and_then(|o| String::from_utf8(o.stdout.clone()).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    if audio_codec.is_empty() {
        return Err(format!(
            "O arquivo não contém trilha de áudio: {}",
            video_path
        ));
    }

    Err(format!(
        "Falha ao extrair áudio (codec origem: '{}'). Detalhe: {}",
        audio_codec,
        encode_stderr
            .lines()
            .take(3)
            .collect::<Vec<_>>()
            .join(" | ")
    ))
}

#[derive(Debug)]
struct WarpError;
impl warp::reject::Reject for WarpError {}