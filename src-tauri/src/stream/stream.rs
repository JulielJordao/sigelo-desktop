// src/stream.rs
//
// Arquitetura multi-sessão:
//   - Cada chamada play_video recebe/gera um session_id.
//   - Um HashMap<String, Session> guarda frame_tx, cmd_tx, path, ffmpeg, offset
//     por sessão → múltiplos players convivem sem colisão.
//   - Servidores warp rodam uma vez e roteiam por session_id no path da URL.
//
// Mudanças principais vs. versão anterior:
//   1. Sem globais singleton para path/ffmpeg/offset (movidos p/ SESSIONS).
//   2. FFmpeg sem -re: throttle 100% no loop Rust → permite N sessões fluindo.
//   3. Áudio HTTP 9002 com rota /{session_id}/stream.aac e CORS no GET.
//   4. WS de controle roteado por session_id.
//   5. stop_video aceita session_id específico.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};
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

#[derive(Deserialize, Debug, Clone)]
struct FrontendCmd {
    cmd: String,
    #[serde(default)] time:    Option<f64>,
    #[serde(default)] rate:    Option<f64>,
    #[serde(default)] enabled: Option<bool>,
    #[serde(default)] muted:   Option<bool>,
    #[serde(default)] volume:  Option<f64>,
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
    duration:  f64,
    fps:       f64,
    has_audio: bool,
}

/// Tudo que pertence a UMA sessão de player.
struct Session {
    frame_tx:     broadcast::Sender<Arc<Vec<u8>>>,
    cmd_tx:       tokio::sync::mpsc::Sender<PipelineCmd>,
    path:         String,
    ffmpeg:       PathBuf,
    audio_offset: Arc<Mutex<f64>>,
}

// =============================================================================
// ESTADO GLOBAL — mapa de sessões + flag de servidores
// =============================================================================

static SESSIONS: Lazy<Mutex<HashMap<String, Arc<Session>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

static SERVERS_UP: Lazy<Mutex<bool>> = Lazy::new(|| Mutex::new(false));

// PipelineState agora só existe para manter compat com tauri::manage — o mapa
// real é o SESSIONS acima.
pub struct PipelineState;
impl Default for PipelineState { fn default() -> Self { Self } }
impl PipelineState { pub fn new() -> Self { Self } }

// =============================================================================
// HELPERS
// =============================================================================

fn ffmpeg_bin(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path()
        .app_local_data_dir()
        .map_err(|e| format!("app_local_data_dir: {}", e))?
        .join("bin");
    let exe = if cfg!(target_os = "windows") { dir.join("ffmpeg.exe") } else { dir.join("ffmpeg") };
    if !exe.exists() { return Err(format!("FFmpeg não encontrado: {:?}", exe)); }
    Ok(exe)
}

fn ffprobe_bin(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path()
        .app_local_data_dir()
        .map_err(|e| format!("app_local_data_dir: {}", e))?
        .join("bin");
    let exe = if cfg!(target_os = "windows") { dir.join("ffprobe.exe") } else { dir.join("ffprobe") };
    if !exe.exists() { return Err(format!("ffprobe não encontrado: {:?}", exe)); }
    Ok(exe)
}

async fn probe(ffprobe: &PathBuf, path: &str) -> MediaInfo {
    let out = Command::new(ffprobe)
        .args(["-v", "quiet", "-print_format", "json",
               "-show_streams", "-show_format", path])
        .output().await;

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
                            "video" => if let Some(r) = s["r_frame_rate"].as_str() {
                                if let Some((n, d)) = r.split_once('/') {
                                    let n: f64 = n.parse().unwrap_or(30.0);
                                    let d: f64 = d.parse().unwrap_or(1.0);
                                    if d > 0.0 { info.fps = n / d; }
                                }
                            },
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
    app:          AppHandle,
    _state:       State<'_, PipelineState>,
    session_id:   String,
    path:         String,
    width:        u32,
    height:       u32,
    render_audio: bool,
    loop_video:   bool,
) -> Result<(), String> {
    // Encerra qualquer sessão pré-existente com o mesmo ID
    stop_session(&session_id);

    let ffmpeg  = ffmpeg_bin(&app)?;
    let ffprobe = ffprobe_bin(&app)?;

    // Sobe servidores warp na 1ª vez
    {
        let mut up = SERVERS_UP.lock().unwrap();
        if !*up { start_warp_servers(); *up = true; }
    }

    let info = probe(&ffprobe, &path).await;

    let (frame_tx, _)   = broadcast::channel::<Arc<Vec<u8>>>(16);
    let (cmd_tx, cmd_rx) = tokio::sync::mpsc::channel::<PipelineCmd>(32);
    let audio_offset     = Arc::new(Mutex::new(0.0f64));

    let sess = Arc::new(Session {
        frame_tx:     frame_tx.clone(),
        cmd_tx:       cmd_tx.clone(),
        path:         path.clone(),
        ffmpeg:       ffmpeg.clone(),
        audio_offset: audio_offset.clone(),
    });
    SESSIONS.lock().unwrap().insert(session_id.clone(), sess);

    // NOTA: render_audio é usado no frontend para decidir se conecta ao HTTP.
    // O servidor 9002 sempre serve áudio quando solicitado.
    let _ = render_audio;

    tokio::spawn(frame_loop(
        session_id, path, width, height, loop_video,
        0.0, info, ffmpeg, frame_tx, cmd_rx, audio_offset,
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
    command:    serde_json::Value,
) -> Result<(), String> {
    let fc: FrontendCmd = serde_json::from_value(command).map_err(|e| e.to_string())?;
    dispatch_cmd(&session_id, &fc);
    Ok(())
}

#[tauri::command]
pub async fn get_video_preview(
    app:       AppHandle,
    path:      String,
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
        .output().await
        .map_err(|e| e.to_string())?;
    if out.status.success() { Ok(out.stdout) }
    else { Err(String::from_utf8_lossy(&out.stderr).to_string()) }
}

// =============================================================================
// FRAME LOOP
// =============================================================================

async fn frame_loop(
    session_id:   String,
    path:         String,
    width:        u32,
    height:       u32,
    loop_video:   bool,
    mut seek:     f64,
    info:         MediaInfo,
    ffmpeg:       PathBuf,
    frame_tx:     broadcast::Sender<Arc<Vec<u8>>>,
    mut cmd_rx:   tokio::sync::mpsc::Receiver<PipelineCmd>,
    audio_offset: Arc<Mutex<f64>>,
) {
    let w = (width / 2) * 2;
    let h = (height / 2) * 2;

    let y_size     = (w * h) as usize;
    let uv_size    = ((w / 2) * (h / 2)) as usize;
    let frame_size = y_size + uv_size * 2;

    let fps      = info.fps.max(1.0);
    let duration = info.duration;

    let mut loop_count:  u64  = 0;
    let mut paused:      bool = false;
    let mut rate:        f64  = 1.0;

    // Base temporal para throttle (substitui o -re do FFmpeg)
    let mut pipeline_start = tokio::time::Instant::now();
    let mut frames_emitted: u64 = 0;

    'outer: loop {
        let mut args: Vec<String> = Vec::new();

        #[cfg(target_os = "windows")]
        args.extend(["-hwaccel".into(), "d3d11va".into()]);

        if loop_video {
            args.extend(["-stream_loop".into(), "-1".into()]);
        }
        if seek > 0.0 {
            args.extend(["-ss".into(), format!("{:.3}", seek)]);
        }

        args.extend([
            "-i".into(), path.clone(),
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
            Err(e) => { eprintln!("[frame_loop {}] spawn: {}", session_id, e); break; }
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

        let mut stdout    = child.stdout.take().unwrap();
        let mut frame_buf = vec![0u8; frame_size];
        let mut frame_idx: u64 = 0;

        let frames_per_pass: u64 = if fps > 0.0 && duration > 0.0 {
            (duration * fps).round() as u64
        } else { u64::MAX };

        pipeline_start  = tokio::time::Instant::now();
        frames_emitted  = 0;

        'read: loop {
            // Drena comandos
            loop {
                match cmd_rx.try_recv() {
                    Ok(PipelineCmd::Stop)        => break 'outer,
                    Ok(PipelineCmd::Pause)       => paused = true,
                    Ok(PipelineCmd::Resume)      => {
                        paused = false;
                        // Recalibra o clock para não "correr" após a pausa
                        pipeline_start = tokio::time::Instant::now();
                        frames_emitted = 0;
                    }
                    Ok(PipelineCmd::SetRate(r))  => {
                        rate = r.clamp(0.25, 4.0);
                        pipeline_start = tokio::time::Instant::now();
                        frames_emitted = 0;
                    }
                    Ok(PipelineCmd::Seek(t))     => {
                        let _ = child.kill().await;
                        seek = t;
                        loop_count = 0;
                        frame_idx  = 0;
                        paused     = false;
                        *audio_offset.lock().unwrap() = t;
                        continue 'outer;
                    }
                    Err(tokio::sync::mpsc::error::TryRecvError::Disconnected) => break 'outer,
                    Err(_) => break,
                }
            }

            if paused {
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                continue;
            }

            // Lê 1 frame
            match stdout.read_exact(&mut frame_buf).await {
                Ok(_) => {
                    frame_idx += 1;

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

                    if is_restart {
                        pipeline_start = tokio::time::Instant::now();
                        frames_emitted = 0;
                    }

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

                    // ── Throttle: pacing baseado em relógio de parede ──
                    // Substitui o -re do FFmpeg: controlamos o tempo entre envios
                    // para que a taxa média = fps * rate.
                    frames_emitted += 1;
                    let expected_ns = (frames_emitted as f64 * 1_000_000_000.0 / (fps * rate)) as u64;
                    let elapsed_ns  = pipeline_start.elapsed().as_nanos() as u64;
                    if expected_ns > elapsed_ns {
                        let sleep_ns = expected_ns - elapsed_ns;
                        // Nunca dorme mais que 200ms de uma vez (responsividade a comandos)
                        let sleep_ns = sleep_ns.min(200_000_000);
                        tokio::time::sleep(std::time::Duration::from_nanos(sleep_ns)).await;
                    }
                }
                Err(e) => {
                    if e.kind() != std::io::ErrorKind::UnexpectedEof {
                        eprintln!("[frame_loop {}] leitura: {}", session_id, e);
                    }
                    break 'read;
                }
            }
        }

        let _ = child.kill().await;

        if loop_video {
            loop_count += 1;
            frame_idx   = 0;
            seek        = 0.0;
            continue 'outer;
        } else {
            break 'outer;
        }
    }

    // Limpa a sessão ao encerrar
    SESSIONS.lock().unwrap().remove(&session_id);
    eprintln!("[frame_loop {}] encerrado.", session_id);
}

// =============================================================================
// SERVIDORES WARP
// =============================================================================

fn start_warp_servers() {
    // ── 9001 — WebSocket vídeo, roteado por /{session_id} ─────────────────
    let video_ws = warp::path::param::<String>()
        .and(warp::ws())
        .map(|sid: String, ws: warp::ws::Ws| {
            ws.on_upgrade(move |socket| async move {
                let rx = {
                    let map = SESSIONS.lock().unwrap();
                    map.get(&sid).map(|s| s.frame_tx.subscribe())
                };
                let mut rx = match rx { Some(r) => r, None => return };

                let (mut sink, _) = socket.split();
                while let Ok(pkt) = rx.recv().await {
                    if sink.send(warp::ws::Message::binary((*pkt).clone())).await.is_err() {
                        break;
                    }
                }
            })
        });

    // ── 9002 — HTTP áudio em fragmented MP4 (MSE-compatível) ──────────────
    //
    // Por que fMP4 e não ADTS:
    //   WKWebView (macOS) e WebView2 (Windows) aceitam `audio/aac` no
    //   MediaSource.isTypeSupported(), mas o appendBuffer falha
    //   SILENCIOSAMENTE com bytes ADTS (sem evento de erro, sem log).
    //   Fragmented MP4 é o formato universal para MSE.
    //
    // Args FFmpeg para fMP4 streamable:
    //   -movflags +frag_keyframe+empty_moov+default_base_moof+faststart
    //
    let audio_route = warp::path!(String / "stream.mp4")
        .and(warp::get())
        .and_then(|sid: String| async move {
            let (ffmpeg, vpath, offset) = {
                let map = SESSIONS.lock().unwrap();
                match map.get(&sid) {
                    Some(s) => (s.ffmpeg.clone(), s.path.clone(), *s.audio_offset.lock().unwrap()),
                    None    => return Ok::<_, warp::Rejection>(
                        Response::builder().status(404).body(warp::hyper::Body::empty()).unwrap()
                    ),
                }
            };

            if vpath.is_empty() || !ffmpeg.exists() {
                return Ok::<_, warp::Rejection>(
                    Response::builder().status(503).body(warp::hyper::Body::empty()).unwrap()
                );
            }

            let mut audio_args: Vec<String> = Vec::new();
            if offset > 0.0 {
                audio_args.extend(["-ss".into(), format!("{:.3}", offset)]);
            }
            audio_args.extend([
                "-i".into(),         vpath,
                "-vn".into(),
                "-acodec".into(),    "aac".into(),
                "-profile:a".into(), "aac_low".into(),
                "-b:a".into(),       "192k".into(),
                "-ac".into(),        "2".into(),
                "-ar".into(),        "44100".into(),
                // ── fMP4 streamable ───────────────────────────────────────
                "-f".into(),         "mp4".into(),
                "-movflags".into(),
                "frag_keyframe+empty_moov+default_base_moof+faststart".into(),
                // Fragmentos pequenos → baixa latência + MSE pode começar cedo
                "-frag_duration".into(), "500000".into(),   // 0.5s
                "-loglevel".into(),  "error".into(),
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
                    .header("Content-Type",                "audio/mp4")
                    .header("Cache-Control",               "no-cache, no-store")
                    .header("Access-Control-Allow-Origin", "*")
                    .header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
                    .header("Access-Control-Allow-Headers", "*")
                    .header("Connection",                  "close")
                    .body(body).unwrap()
            )
        });

    let audio_options = warp::path!(String / "stream.mp4")
        .and(warp::options())
        .map(|_sid: String| {
            Response::builder()
                .status(204)
                .header("Access-Control-Allow-Origin",  "*")
                .header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
                .header("Access-Control-Allow-Headers", "*")
                .body(warp::hyper::Body::empty()).unwrap()
        });

    // ── 9003 — WebSocket controle, rota /{session_id} ─────────────────────
    let ctrl_ws = warp::path::param::<String>()
        .and(warp::ws())
        .map(|sid: String, ws: warp::ws::Ws| {
            ws.on_upgrade(move |socket| async move {
                let (mut sink, mut stream) = socket.split();
                while let Some(Ok(msg)) = stream.next().await {
                    if !msg.is_text() { continue; }
                    let text = match msg.to_str() { Ok(t) => t, Err(_) => continue };

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
        warp::serve(audio_options.or(audio_route))
            .run(([127, 0, 0, 1], 9002)).await;
    });
    tokio::spawn(async move {
        warp::serve(ctrl_ws).run(([127, 0, 0, 1], 9003)).await;
    });

    eprintln!("[stream] Servidores 9001/9002/9003 iniciados (multi-sessão).");
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
        "pause"      => Some(PipelineCmd::Pause),
        "play"       => Some(PipelineCmd::Resume),
        "seek"       => fc.time.map(PipelineCmd::Seek),
        "set_rate"   => fc.rate.map(|r| PipelineCmd::SetRate(r.clamp(0.25, 4.0))),
        "set_loop"   => fc.enabled.map(|_| PipelineCmd::Resume),
        "set_muted"  => None,
        "set_volume" => None,
        _            => None,
    };

    if let Some(cmd) = maybe_cmd {
        let tx = {
            let map = SESSIONS.lock().unwrap();
            map.get(session_id).map(|s| s.cmd_tx.clone())
        };
        if let Some(tx) = tx { let _ = tx.try_send(cmd); }
    }
}

#[derive(Debug)]
struct WarpError;
impl warp::reject::Reject for WarpError {}