use futures_util::SinkExt;
use futures_util::StreamExt;
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use tauri::Manager;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::net::{TcpListener, TcpSocket};
use tokio::process::{Child, Command};
use tokio::sync::{broadcast, Mutex};
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

/// Estado global do pipeline. Envolto em Arc<Mutex> para ser
/// compartilhado com segurança entre as threads do Tokio.
pub struct PipelineState {
    /// Handle do processo FFmpeg ativo, para podermos matar antes de iniciar outro.
    child: Option<Child>,
    /// Canal de broadcast dos frames. Substituído a cada novo vídeo.
    tx: Option<broadcast::Sender<Vec<u8>>>,
    /// Sinaliza para o loop do TcpListener parar de aceitar conexões.
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
    // Guarda a task do listener para garantir que ele foi encerrado
    listener_task: Option<tokio::task::JoinHandle<()>>,
}

impl PipelineState {
    pub fn new() -> Self {
        Self {
            child: None,
            tx: None,
            shutdown_tx: None,
            listener_task: None, // Inicializa como None
        }
    }

    pub async fn stop(&mut self) {
        // 1. Envia sinal para o WebSocket server fechar
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }

        // 2. Mata o processo FFmpeg
        if let Some(mut child) = self.child.take() {
            let _ = child.kill().await;
        }

        // 3. Descarta o canal de broadcast
        self.tx = None;

        // 4. NOVO: Aguarda a thread do listener morrer de fato e liberar a porta no S.O.
        if let Some(handle) = self.listener_task.take() {
            let _ = handle.await;
        }
    }
}

/// Tipo compartilhável do estado — usado como estado Tauri.
pub type SharedPipelineState = Arc<Mutex<PipelineState>>;

pub async fn start_ffmpeg_pipeline(
    ffmpeg_path: &str,
    state: SharedPipelineState,
    video_path: &str,
    width: usize,
    height: usize,
) -> Result<(), String> {
    if !Path::new(ffmpeg_path).exists() {
        return Err(format!("FFmpeg não encontrado: {}", ffmpeg_path));
    }
    if !Path::new(video_path).exists() {
        return Err(format!("Vídeo não encontrado: {}", video_path));
    }

    let y_size = width * height;
    let uv_size = width * (height / 2);
    let frame_size = y_size + uv_size;

    // --- 1. Para o pipeline anterior e aguarda liberação ---
    {
        let mut s = state.lock().await;
        s.stop().await;
    }

    // --- 2. Otimização de Hardware por OS ---
    let mut ffmpeg_args: Vec<String> = Vec::new();

    if cfg!(target_os = "windows") {
        ffmpeg_args.push("-hwaccel".into());
        ffmpeg_args.push("d3d11va".into());
    } else if cfg!(target_os = "macos") {
        ffmpeg_args.push("-hwaccel".into());
        ffmpeg_args.push("videotoolbox".into()); // Ultra otimizado para o Mac M4
    } else if cfg!(target_os = "linux") {
        ffmpeg_args.push("-hwaccel".into());
        ffmpeg_args.push("vaapi".into());
    }

    let vf_filter = format!("scale={}:{},format=nv12", width, height);

    // Argumentos universais do pipeline
    let base_args = [
        "-re", // Limita o processamento à velocidade real (salva CPU)
        "-stream_loop", "-1",
        "-i", video_path,
        "-vf", &vf_filter,
        "-f", "rawvideo",
        "-pix_fmt", "nv12",
        "-an", // Sem áudio
        "-sn", // Sem legendas (economiza processamento)
        "-loglevel", "error",
        "pipe:1",
    ];

    for arg in base_args {
        ffmpeg_args.push(arg.to_string());
    }

    // --- 3. Inicia o Processo ---
    let mut child = Command::new(ffmpeg_path)
        .args(&ffmpeg_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Falha ao iniciar FFmpeg: {}", e))?;

    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr);
            let mut line = String::new();
            while reader.read_line(&mut line).await.unwrap_or(0) > 0 {
                eprintln!("[FFmpeg] {}", line.trim());
                line.clear();
            }
        });
    }

    let mut stdout = child
        .stdout
        .take()
        .ok_or("Falha ao capturar stdout do FFmpeg")?;

    let (tx, _) = broadcast::channel::<Vec<u8>>(4);
    let tx_clone = tx.clone();

    // Task de leitura de frames
    tokio::spawn(async move {
        let mut buffer = vec![0u8; frame_size];
        loop {
            match stdout.read_exact(&mut buffer).await {
                Ok(_) => {
                    let _ = tx_clone.send(buffer.clone());
                }
                Err(e) => {
                    eprintln!("[Pipeline] FFmpeg encerrou a leitura: {}", e);
                    break;
                }
            }
        }
    });

    let (shutdown_tx, mut shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    // --- 4. Liberação Instantânea de Porta (Multi-OS) ---
    let socket = TcpSocket::new_v4().map_err(|e| format!("Erro ao criar socket: {}", e))?;
    
    // Windows, macOS e Linux suportam REUSEADDR
    socket.set_reuseaddr(true).map_err(|e| format!("Erro ao configurar reuseaddr: {}", e))?;
    
    // Liberação extra agressiva exclusiva para sistemas baseados em Unix
    #[cfg(not(windows))]
    {
        socket.set_reuseport(true).map_err(|e| format!("Erro ao configurar reuseport: {}", e))?;
    }

    let addr = "127.0.0.1:9001".parse().unwrap();
    socket.bind(addr).map_err(|e| format!("Porta 9001 indisponível: {}", e))?;
    let listener = socket.listen(1024).map_err(|e| format!("Erro ao escutar: {}", e))?;

    println!("[Pipeline] WebSocket pronto em ws://127.0.0.1:9001");

    let tx_for_listener = tx.clone(); 

    // --- 5. Task do Listener ---
    let listener_handle = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut shutdown_rx => {
                    println!("[Pipeline] Shutdown recebido, encerrando listener.");
                    break;
                }
                result = listener.accept() => {
                    match result {
                        Ok((stream, addr)) => {
                            println!("[Pipeline] Cliente conectado: {}", addr);
                            let ws_stream = match accept_async(stream).await {
                                Ok(ws) => ws,
                                Err(e) => {
                                    eprintln!("[Pipeline] Handshake WebSocket falhou: {}", e);
                                    continue;
                                }
                            };
                            
                            let mut rx = tx_for_listener.subscribe(); 
                            let (mut ws_sender, _) = ws_stream.split();
                            
                            tokio::spawn(async move {
                                loop {
                                    match rx.recv().await {
                                        Ok(frame_data) => {
                                            if ws_sender.send(Message::Binary(frame_data.into())).await.is_err() {
                                                break;
                                            }
                                        }
                                        Err(broadcast::error::RecvError::Lagged(_)) => continue,
                                        Err(broadcast::error::RecvError::Closed) => break,
                                    }
                                }
                            });
                        }
                        Err(e) => eprintln!("[Pipeline] Erro ao aceitar conexão: {}", e),
                    }
                }
            }
        }
    });

    // --- 6. Salva o Estado Seguro ---
    {
        let mut s = state.lock().await;
        s.child = Some(child);
        s.tx = Some(tx); 
        s.shutdown_tx = Some(shutdown_tx);
        s.listener_task = Some(listener_handle);
    }

    Ok(())
}/// Comando Tauri: inicia um novo vídeo.
/// Adicione ao seu main.rs: .invoke_handler(tauri::generate_handler![play_video, stop_video])
#[tauri::command]
pub async fn play_video(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, SharedPipelineState>,
    path: String,
    width: usize,
    height: usize,
) -> Result<(), String> {
    let local_data_dir = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Erro ao obter diretório local: {}", e))?;

    // 2. Constrói o caminho corretamente reatribuindo o valor de join
    let mut ffmpeg_path = local_data_dir.join("bin");

    if cfg!(target_os = "windows") {
        ffmpeg_path.push("ffmpeg.exe");
    } else {
        ffmpeg_path.push("ffmpeg");
    }

    let ffmpeg_str = ffmpeg_path.to_string_lossy();

    start_ffmpeg_pipeline(&ffmpeg_str, Arc::clone(&state), &path, width, height).await
}

/// Comando Tauri: para o pipeline atual.
#[tauri::command]
pub async fn stop_video(state: tauri::State<'_, SharedPipelineState>) -> Result<(), String> {
    let mut s = state.lock().await;
    s.stop().await;
    Ok(())
}

/// Tenta encontrar o FFmpeg: primeiro no bundle do app, depois no PATH do sistema.
fn locate_ffmpeg() -> String {
    // Em produção, o FFmpeg bundled fica em resources/ffmpeg (ou ffmpeg.exe no Windows)
    let bundled = if cfg!(target_os = "windows") {
        "resources/ffmpeg.exe"
    } else {
        "resources/ffmpeg"
    };

    if Path::new(bundled).exists() {
        return bundled.to_string();
    }

    // Fallback: ffmpeg no PATH do sistema
    "ffmpeg".to_string()
}
