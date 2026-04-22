// src/stream.rs

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tauri::{command, AppHandle, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::broadcast;
use warp::{Filter, http::Response};
use serde_json::json;
use once_cell::sync::Lazy;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio_util::io::ReaderStream;

// =============================================================================
// TIPOS
// =============================================================================

/// Comandos que o frontend envia via WS 9003
#[derive(Deserialize, Debug, Clone)]
struct FrontendCmd {
    cmd: String,
    #[serde(default)] time:    Option<f64>,
    #[serde(default)] rate:    Option<f64>,
    #[serde(default)] enabled: Option<bool>,
    #[serde(default)] muted:   Option<bool>,
    #[serde(default)] volume:  Option<f64>,
}

/// Comandos internos para o loop de frames
#[derive(Debug, Clone)]
enum PipelineCmd {
    Pause,
    Resume,
    Seek(f64),
    SetRate(f64),
    Stop,
}

/// Metadados do arquivo extraídos via ffprobe
#[derive(Clone, Debug)]
struct MediaInfo {
    duration: f64,
    fps:      f64,
    has_audio: bool,
}

// =============================================================================
// ESTADO TAURI
// =============================================================================

pub struct PipelineState {
    /// Canal para enviar comandos ao loop de frames em execução
    cmd_tx: Arc<Mutex<Option<tokio::sync::mpsc::Sender<PipelineCmd>>>>,
    /// Canal broadcast de frames (compartilhado com os clientes WS)
    frame_tx: Arc<Mutex<Option<broadcast::Sender<Arc<Vec<u8>>>>>>,
}

impl Default for PipelineState {
    fn default() -> Self {
        Self {
            cmd_tx:   Arc::new(Mutex::new(None)),
            frame_tx: Arc::new(Mutex::new(None)),
        }
    }
}

impl PipelineState {
    pub fn new() -> Self { Self::default() }
}

// =============================================================================
// GLOBAIS (necessários para os handlers do warp que não têm acesso ao State)
// =============================================================================

/// Caminho do ffmpeg — setado em play_video, lido pelo handler de áudio
static FFMPEG_BIN: Lazy<Mutex<PathBuf>> =
    Lazy::new(|| Mutex::new(PathBuf::new()));

/// Caminho do vídeo atual — lido pelo handler de áudio
static CURRENT_PATH: Lazy<Mutex<String>> =
    Lazy::new(|| Mutex::new(String::new()));

/// Offset de seek atual — o handler de áudio usa para sincronizar com o vídeo
static AUDIO_SEEK_OFFSET: Lazy<Mutex<f64>> =
    Lazy::new(|| Mutex::new(0.0));

/// Garante que os servidores warp só são iniciados uma vez
static SERVERS_UP: Lazy<Mutex<bool>> =
    Lazy::new(|| Mutex::new(false));

// =============================================================================
// HELPERS
// =============================================================================

fn ffmpeg_bin(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path()
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
    let dir = app.path()
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

/// Extrai duration, fps e has_audio do arquivo via ffprobe
async fn probe(ffprobe: &PathBuf, path: &str) -> MediaInfo {
    let out = Command::new(ffprobe)
        .args([
            "-v", "quiet",
            "-print_format", "json",
            "-show_streams",
            "-show_format",
            path,
        ])
        .output()
        .await;

    let mut info = MediaInfo { duration: 0.0, fps: 30.0, has_audio: false };

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
                                        if d > 0.0 { info.fps = n / d; }
                                    }
                                }
                            }
                            "audio" => { info.has_audio = true; }
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
    app:          AppHandle,
    state:        State<'_, PipelineState>,
    path:         String,
    width:        u32,
    height:       u32,
    render_audio: bool,
    loop_video:   bool,
) -> Result<(), String> {
    // Para qualquer pipeline anterior
    stop_pipeline(&state);

    let ffmpeg  = ffmpeg_bin(&app)?;
    let ffprobe = ffprobe_bin(&app)?;

    // Salva para o handler de áudio (dentro do warp, sem acesso ao State)
    *FFMPEG_BIN.lock().unwrap()        = ffmpeg.clone();
    *CURRENT_PATH.lock().unwrap()      = path.clone();
    *AUDIO_SEEK_OFFSET.lock().unwrap() = 0.0;

    // Sobe os servidores warp na primeira vez
    {
        let mut up = SERVERS_UP.lock().unwrap();
        if !*up {
            start_warp_servers(state.frame_tx.clone());
            *up = true;
        }
    }

    // Probe — obtém fps e duration reais
    let info = probe(&ffprobe, &path).await;

    // Canal de frames (Arc<Vec<u8>> = zero-copy para múltiplos clientes WS)
    let (frame_tx, _) = broadcast::channel::<Arc<Vec<u8>>>(8);
    *state.frame_tx.lock().unwrap() = Some(frame_tx.clone());

    // Canal de comandos
    let (cmd_tx, cmd_rx) = tokio::sync::mpsc::channel::<PipelineCmd>(32);
    *state.cmd_tx.lock().unwrap() = Some(cmd_tx);

    // Inicia loop de frames numa task dedicada
    tokio::spawn(frame_loop(
        path,
        width,
        height,
        loop_video,
        0.0,          // seek_offset inicial
        info,
        ffmpeg,
        frame_tx,
        cmd_rx,
    ));

    Ok(())
}

#[tauri::command]
pub fn stop_video(state: State<'_, PipelineState>) {
    stop_pipeline(&state);
}

/// Envio de qualquer comando de controle do frontend
#[tauri::command]
pub async fn send_video_command(
    state:   State<'_, PipelineState>,
    command: serde_json::Value,
) -> Result<(), String> {
    let fc: FrontendCmd = serde_json::from_value(command)
        .map_err(|e| e.to_string())?;

    dispatch_cmd(&state, &fc);
    Ok(())
}

#[tauri::command]
pub async fn get_video_preview(
    app:   AppHandle,
    path:  String,
    timestamp: Option<f64>,
) -> Result<Vec<u8>, String> {
    let ffmpeg = ffmpeg_bin(&app)?;
    let ts = timestamp.unwrap_or(0.0);

    let out = Command::new(ffmpeg)
        .args([
            "-ss", &format!("{:.3}", ts),
            "-i", &path,
            "-vframes", "1",
            "-f", "image2pipe",
            "-vcodec", "mjpeg",
            "-",
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if out.status.success() { Ok(out.stdout) }
    else { Err(String::from_utf8_lossy(&out.stderr).to_string()) }
}

// =============================================================================
// LOOP DE FRAMES
// =============================================================================

/// Roda indefinidamente até receber PipelineCmd::Stop.
/// Reinicia o processo FFmpeg sozinho em caso de seek ou fim de vídeo com loop.
async fn frame_loop(
    path:        String,
    width:       u32,
    height:      u32,
    loop_video:  bool,
    mut seek:    f64,
    info:        MediaInfo,
    ffmpeg:      PathBuf,
    frame_tx:    broadcast::Sender<Arc<Vec<u8>>>,
    mut cmd_rx:  tokio::sync::mpsc::Receiver<PipelineCmd>,
) {
    // Força dimensões múltiplas de 2 (subsampling 4:2:0)
    let w = (width  / 2) * 2;
    let h = (height / 2) * 2;

    let y_size     = (w * h) as usize;
    let uv_size    = ((w / 2) * (h / 2)) as usize;
    let frame_size = y_size + uv_size * 2;   // YUV420P

    let fps      = info.fps;
    let duration = info.duration;

    let mut loop_count:  u64 = 0;
    let mut paused:      bool = false;
    let mut rate:        f64  = 1.0;

    'outer: loop {
        // ── Inicia FFmpeg ──────────────────────────────────────────────────
        let mut args: Vec<String> = Vec::new();

        // macOS: NÃO usar videotoolbox — causa travamento em M-series com pipe rawvideo
        #[cfg(target_os = "windows")]
        args.extend(["-hwaccel".into(), "d3d11va".into()]);

        // -stream_loop ANTES de -i (obrigatório para funcionar)
        if loop_video {
            args.extend(["-stream_loop".into(), "-1".into()]);
        }

        // Seek input-side: antes de -i = keyframe seek rápido
        if seek > 0.0 {
            args.extend(["-ss".into(), format!("{:.3}", seek)]);
        }

        args.extend([
            "-i".into(), path.clone(),
            // -re APÓS -i (com -stream_loop antes de -i, -re antes de -i causa burst)
            "-re".into(),
            "-vf".into(),       format!("scale={}:{},format=yuv420p", w, h),
            "-f".into(),        "rawvideo".into(),
            "-pix_fmt".into(),  "yuv420p".into(),
            "-an".into(),
            "-sn".into(),
            "-loglevel".into(), "error".into(),
            "pipe:1".into(),
        ]);

        let mut child = match Command::new(&ffmpeg)
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
        {
            Ok(c) => c,
            Err(e) => { eprintln!("[frame_loop] spawn falhou: {}", e); break; }
        };

        // Log stderr em background
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr);
                let mut line   = String::new();
                while reader.read_line(&mut line).await.unwrap_or(0) > 0 {
                    eprint!("[FFmpeg] {}", line);
                    line.clear();
                }
            });
        }

        let mut stdout     = child.stdout.take().unwrap();
        let mut frame_buf  = vec![0u8; frame_size];
        let mut frame_idx: u64 = 0;

        // Frames totais por passagem (para PTS monotônico)
        let frames_per_pass: u64 = if fps > 0.0 && duration > 0.0 {
            (duration * fps).round() as u64
        } else {
            u64::MAX
        };

        // ── Loop de leitura de frames ──────────────────────────────────────
        'read: loop {
            // Drena comandos pendentes (não-bloqueante)
            loop {
                match cmd_rx.try_recv() {
                    Ok(PipelineCmd::Stop)        => break 'outer,
                    Ok(PipelineCmd::Pause)       => { paused = true; }
                    Ok(PipelineCmd::Resume)      => { paused = false; }
                    Ok(PipelineCmd::SetRate(r))  => { rate = r.clamp(0.25, 4.0); }
                    Ok(PipelineCmd::Seek(t))     => {
                        // Reinicia o FFmpeg com novo seek
                        let _ = child.kill().await;
                        seek = t;
                        loop_count = 0;
                        frame_idx  = 0;
                        paused     = false;
                        // Atualiza o offset do áudio para sincronização A/V
                        *AUDIO_SEEK_OFFSET.lock().unwrap() = t;
                        continue 'outer;
                    }
                    Err(tokio::sync::mpsc::error::TryRecvError::Disconnected) => break 'outer,
                    Err(_) => break,
                }
            }

            if paused {
                tokio::time::sleep(std::time::Duration::from_millis(8)).await;
                continue;
            }

            // Lê exatamente um frame
            match stdout.read_exact(&mut frame_buf).await {
                Ok(_) => {
                    frame_idx += 1;

                    // PTS MONOTÔNICO — nunca volta a 0 nos loops
                    let (frame_in_pass, is_restart) = if loop_video && frames_per_pass < u64::MAX {
                        let f = frame_idx % frames_per_pass;
                        let r = f == 0 && frame_idx > 0;
                        if r { loop_count += 1; }
                        (if f == 0 { frames_per_pass } else { f }, r)
                    } else {
                        (frame_idx, false)
                    };

                    let pts = if loop_video && frames_per_pass < u64::MAX {
                        (loop_count * frames_per_pass + frame_in_pass) as f64 / fps + seek
                    } else {
                        frame_idx as f64 / fps + seek
                    };

                    let meta = json!({
                        "pts":            pts,
                        "duration":       duration,
                        "video_width":    w,
                        "video_height":   h,
                        "fps":            fps,
                        "sample_rate":    48000,
                        "audio_channels": 2,
                        "has_audio":      info.has_audio,
                        "loop_restart":   is_restart,
                    });

                    let meta_bytes = meta.to_string();
                    let total      = meta_bytes.len() + 1 + frame_size;
                    let mut pkt    = Vec::with_capacity(total);
                    pkt.extend_from_slice(meta_bytes.as_bytes());
                    pkt.push(b'|');
                    pkt.extend_from_slice(&frame_buf);

                    let _ = frame_tx.send(Arc::new(pkt));

                    // Throttle para playbackRate ≠ 1.0
                    if (rate - 1.0).abs() > 0.05 {
                        let delay_ms = (1000.0 / fps / rate) as u64;
                        tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                    }
                }
                Err(e) => {
                    if e.kind() == std::io::ErrorKind::UnexpectedEof {
                        // EOF normal: fim do arquivo
                    } else {
                        eprintln!("[frame_loop] leitura: {}", e);
                    }
                    break 'read;
                }
            }
        }

        let _ = child.kill().await;

        // Se loop manual (sem -stream_loop): reinicia
        if loop_video {
            loop_count += 1;
            frame_idx   = 0;
            seek        = 0.0;   // volta ao início em cada loop
            continue 'outer;
        } else {
            break 'outer;
        }
    }

    eprintln!("[frame_loop] encerrado.");
}

// =============================================================================
// SERVIDORES WARP
// =============================================================================

/// Inicia os três servidores (9001 vídeo WS, 9002 áudio HTTP, 9003 controle WS).
/// Chamado uma única vez. Os handlers leem os globais FFMPEG_BIN / CURRENT_PATH.
fn start_warp_servers(
    frame_tx_arc: Arc<Mutex<Option<broadcast::Sender<Arc<Vec<u8>>>>>>,
) {
    let ftx = frame_tx_arc.clone();

    // ── 9001 — WebSocket de vídeo ──────────────────────────────────────────
    let video_ws = warp::ws().map(move |ws: warp::ws::Ws| {
        let ftx = ftx.clone();
        ws.on_upgrade(move |socket| async move {
            let rx = {
                let guard = ftx.lock().unwrap();
                guard.as_ref().map(|tx| tx.subscribe())
            };
            let mut rx = match rx {
                Some(r) => r,
                None    => return,
            };
            let (mut sink, _) = socket.split();
            while let Ok(pkt) = rx.recv().await {
                // Clone do Arc (ponteiro) — sem cópia dos bytes
                if sink.send(warp::ws::Message::binary((*pkt).clone())).await.is_err() {
                    break;
                }
            }
        })
    });

    // ── 9002 — HTTP de áudio AAC ───────────────────────────────────────────
    //
    //  CORREÇÃO "SEM ÁUDIO":
    //  O servidor antigo passava -re para o FFmpeg de áudio, o que causava
    //  problemas com o player HTTP do browser (que faz buffering próprio).
    //  Além disso, o offset de seek não era aplicado → dessync A/V.
    //
    //  Agora:
    //  1. Sem -re no áudio (o browser puxa no ritmo que precisa)
    //  2. -ss <AUDIO_SEEK_OFFSET> garante que áudio comece no mesmo ponto do vídeo
    //  3. Headers corretos: Content-Type, Cache-Control, Transfer-Encoding
    //
    let audio_route = warp::path("stream.aac")
        .and(warp::get())
        .and_then(|| async {
            let ffmpeg = FFMPEG_BIN.lock().unwrap().clone();
            let vpath  = CURRENT_PATH.lock().unwrap().clone();
            let offset = *AUDIO_SEEK_OFFSET.lock().unwrap();

            if vpath.is_empty() || !ffmpeg.exists() {
                return Ok::<_, warp::Rejection>(
                    Response::builder().status(503).body(warp::hyper::Body::empty()).unwrap()
                );
            }

            let mut audio_args: Vec<String> = Vec::new();

            // Seek sincronizado com o vídeo
            if offset > 0.0 {
                audio_args.extend(["-ss".into(), format!("{:.3}", offset)]);
            }

            audio_args.extend([
                "-i".into(),           vpath,
                "-vn".into(),
                // AAC-LC com alta qualidade e latência reduzida
                "-acodec".into(),      "aac".into(),
                "-profile:a".into(),   "aac_low".into(),
                "-b:a".into(),         "192k".into(),
                "-ac".into(),          "2".into(),          // sempre stereo
                "-ar".into(),          "44100".into(),      // sample rate fixo
                "-f".into(),           "adts".into(),
                "-loglevel".into(),    "error".into(),
                "pipe:1".into(),
            ]);

            let mut child = Command::new(&ffmpeg)
                .args(&audio_args)
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .kill_on_drop(true)
                .spawn()
                .map_err(|_| warp::reject::custom(WarpError))?;

            let stdout = child.stdout.take().unwrap();
            let stream = ReaderStream::new(stdout);
            let body   = warp::hyper::Body::wrap_stream(stream);

            Ok::<_, warp::Rejection>(
                Response::builder()
                    .status(200)
                    .header("Content-Type",                "audio/aac")
                    .header("Cache-Control",               "no-cache, no-store")
                    .header("Access-Control-Allow-Origin", "*")
                    .header("Connection",                  "close")
                    .body(body)
                    .unwrap()
            )
        });

    // ── 9003 — WebSocket de controle ──────────────────────────────────────
    //
    //  Recebe os mesmos JSONs que o FFmpegVideo.ts envia via _sendCmd.
    //  Mapeia para os globais PENDING_* ou para Tauri diretamente.
    //  Nota: como o warp não tem acesso ao State do Tauri, usamos o global
    //  AUDIO_SEEK_OFFSET para seek e delegamos o restart do pipeline ao
    //  frontend (que chama play_video novamente via invoke).
    //
    let ctrl_ws = warp::any().and(warp::ws()).map(move |ws: warp::ws::Ws| {
        ws.on_upgrade(move |socket| async move {
            let (mut sink, mut stream) = socket.split();
            while let Some(Ok(msg)) = stream.next().await {
                if !msg.is_text() { continue; }
                let text = match msg.to_str() { Ok(t) => t, Err(_) => continue };

                if let Ok(cmd) = serde_json::from_str::<FrontendCmd>(text) {
                    // Seek atualiza o offset do áudio imediatamente.
                    // O frontend já reinicia o pipeline via invoke('play_video')
                    // ao receber seek, então aqui só precisamos sincronizar o áudio.
                    if cmd.cmd == "seek" {
                        if let Some(t) = cmd.time {
                            *AUDIO_SEEK_OFFSET.lock().unwrap() = t;
                        }
                    }
                }

                let _ = sink.send(warp::ws::Message::text(r#"{"ok":true}"#)).await;
            }
        })
    });

    tokio::spawn(async move {
        warp::serve(video_ws).run(([127, 0, 0, 1], 9001)).await;
    });
    tokio::spawn(async move {
        warp::serve(audio_route).run(([127, 0, 0, 1], 9002)).await;
    });
    tokio::spawn(async move {
        warp::serve(ctrl_ws).run(([127, 0, 0, 1], 9003)).await;
    });

    eprintln!("[stream] Servidores 9001/9002/9003 iniciados.");
}

// =============================================================================
// HELPERS INTERNOS
// =============================================================================

/// Para o pipeline atual enviando PipelineCmd::Stop
fn stop_pipeline(state: &State<'_, PipelineState>) {
    if let Some(tx) = state.cmd_tx.lock().unwrap().take() {
        let _ = tx.try_send(PipelineCmd::Stop);
    }
    *state.frame_tx.lock().unwrap() = None;
}

/// Traduz FrontendCmd → PipelineCmd e envia ao loop de frames
fn dispatch_cmd(state: &State<'_, PipelineState>, fc: &FrontendCmd) {
    let maybe_cmd = match fc.cmd.as_str() {
        "pause"      => Some(PipelineCmd::Pause),
        "play"       => Some(PipelineCmd::Resume),
        "seek"       => fc.time.map(PipelineCmd::Seek),
        "set_rate"   => fc.rate.map(|r| PipelineCmd::SetRate(r.clamp(0.25, 4.0))),
        "set_loop"   => fc.enabled.map(|_| PipelineCmd::Resume), // loop é passado em play_video
        "set_muted"  => None,   // tratado puramente no frontend
        "set_volume" => None,   // idem
        _            => None,
    };

    if let Some(cmd) = maybe_cmd {
        if let Some(tx) = &*state.cmd_tx.lock().unwrap() {
            let _ = tx.try_send(cmd);
        }
    }
}

#[derive(Debug)]
struct WarpError;
impl warp::reject::Reject for WarpError {}