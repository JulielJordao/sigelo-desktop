// ═════════════════════════════════════════════════════════════════════════
// BROADCAST SERVER — Servidor HTTP local pra OBS/vMix
// ─────────────────────────────────────────────────────────────────────────
// Cria um servidor HTTP local que serve a página de overlays e expõe
// um WebSocket pra atualizações em tempo real.
//
// O usuário cola a URL no OBS Studio:
//   "Browser Source" → URL: http://192.168.0.10:7891/overlay
// ═════════════════════════════════════════════════════════════════════════


use axum::{
    body::Body,
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::{header, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::get,
    Router,
};
use futures_util::{sink::SinkExt, stream::StreamExt};
use local_ip_address::local_ip;
use serde_json::Value;
use std::path::Path;
use std::{
    net::{IpAddr, SocketAddr},
    sync::Arc,
};
use tauri::{AppHandle, Emitter, Manager, State as TauriState, Wry};
use tokio::fs;
use tokio::sync::{broadcast, Mutex};
use tower_http::cors::CorsLayer;

#[derive(serde::Deserialize)]
pub struct LocalFileQuery {
    path: String,
}

// ─── Handler de fontes ────────────────────────────────────────────────────
//
// Serve fontes empacotadas (em src-tauri/src/fonts/) e fontes
// instaladas pelo usuário (caminhos absolutos).
// Rota:
//   GET /fonts/<nome>            → busca em src-tauri/src/fonts/
//   GET /fonts?path=<absoluto>   → serve do caminho absoluto (custom)

#[derive(serde::Deserialize)]
pub struct FontQuery {
    path: Option<String>,
}

/// Resolve MIME type de fonte pela extensão.
fn font_mime(ext: &str) -> &'static str {
    match ext.to_lowercase().as_str() {
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    }
}

/// Tenta achar uma fonte com qualquer extensão suportada dentro de um diretório.
fn find_font_in_dir(dir: &Path, base_name: &str) -> Option<std::path::PathBuf> {
    for ext in &["ttf", "otf", "woff", "woff2", "TTF", "OTF"] {
        let p = dir.join(format!("{base_name}.{ext}"));
        if p.exists() && p.is_file() {
            return Some(p);
        }
    }
    None
}

/// Serve uma fonte do bundle por nome de arquivo (sem extensão).
///
/// Usa o AppHandle pra resolver o resource_dir do Tauri, que é o
/// lugar correto tanto em dev quanto em release.
/// Aceita o nome da família (ex: "Inter") OU o fileName completo
/// (ex: "Inter_18pt-Regular"). Quando recebe só o nome da família,
/// faz glob no diretório pra achar qualquer arquivo que comece com
/// esse nome.
async fn serve_bundled_font(
    axum::extract::Path(name): axum::extract::Path<String>,
    State(state): State<BroadcastState>,
) -> Response {
    let resource_dir = state.resource_dir.lock().await;

    // Diretórios candidatos: resource_dir tem prioridade (produção),
    // depois caminhos relativos (desenvolvimento).
    let mut dirs: Vec<std::path::PathBuf> = Vec::new();
    if !resource_dir.is_empty() {
        dirs.push(std::path::PathBuf::from(resource_dir.as_str()).join("fonts"));
    }
    dirs.push(std::path::PathBuf::from("src/fonts"));
    dirs.push(std::path::PathBuf::from("src-tauri/src/fonts"));
    dirs.push(std::path::PathBuf::from("../src/fonts"));

    for dir in &dirs {
        // 1) Tentativa exata: nome com extensão embutida
        if let Some(dot) = name.rfind('.') {
            let p = dir.join(&name);
            if p.exists() && p.is_file() {
                let ext = name[dot + 1..].to_lowercase();
                return serve_font_bytes(&p, &ext).await;
            }
        }

        // 2) Tentativa com extensões conhecidas (nome exato)
        for ext in &["ttf", "otf", "woff2", "woff"] {
            let p = dir.join(format!("{name}.{ext}"));
            if p.exists() && p.is_file() {
                return serve_font_bytes(&p, ext).await;
            }
        }

        // 3) Glob: achar qualquer arquivo cujo nome começa com o nome da família
        //    Ex: "Inter" → acha "Inter_18pt-Regular.ttf", "Inter-Bold.ttf", etc.
        //    Retorna o primeiro regular/normal que encontrar.
        if let Ok(entries) = std::fs::read_dir(dir) {
            let mut fallback: Option<std::path::PathBuf> = None;
            let name_lower = name.to_lowercase();

            for entry in entries.flatten() {
                let fname = entry.file_name().to_string_lossy().to_lowercase();
                if fname.starts_with(&name_lower) {
                    let ext = std::path::Path::new(&fname)
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("");
                    if matches!(ext, "ttf" | "otf" | "woff2" | "woff") {
                        // Prefere variações "regular" / sem sufixo de peso
                        if fname.contains("regular") || !fname.contains('-') {
                            return serve_font_bytes(&entry.path(), ext).await;
                        }
                        fallback = Some(entry.path());
                    }
                }
            }

            if let Some(p) = fallback {
                let ext = p
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("ttf")
                    .to_lowercase();
                return serve_font_bytes(&p, &ext).await;
            }
        }
    }

    (StatusCode::NOT_FOUND, format!("Font not found: {name}")).into_response()
}

async fn serve_font_bytes(path: &std::path::Path, ext: &str) -> Response {
    match fs::read(path).await {
        Ok(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, font_mime(ext))
            .header(header::CACHE_CONTROL, "public, max-age=86400")
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(Body::from(bytes))
            .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Build error").into_response()),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Read error: {e}"),
        )
            .into_response(),
    }
}

/// Serve uma fonte custom de caminho absoluto (?path=/abs/path/to/font.ttf)
async fn serve_custom_font(Query(params): Query<FontQuery>) -> Response {
    let Some(path_str) = params.path else {
        return (StatusCode::BAD_REQUEST, "missing path").into_response();
    };
    let path = Path::new(&path_str);

    if !path.exists() || !path.is_file() {
        return (StatusCode::NOT_FOUND, "Font not found").into_response();
    }

    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("ttf");

    match fs::read(&path).await {
        Ok(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, font_mime(ext))
            .header(header::CACHE_CONTROL, "public, max-age=86400")
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(Body::from(bytes))
            .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Build error").into_response()),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Read error").into_response(),
    }
}

// ═════════════════════════════════════════════════════════════════════════
// ESTADO COMPARTILHADO
// ═════════════════════════════════════════════════════════════════════════

#[derive(Clone)]
pub struct BroadcastState {
    /// Canal pra mandar updates pra todos os clientes WebSocket conectados
    pub tx: broadcast::Sender<String>,
    /// Configuração atual (último estado conhecido)
    pub current_config: Arc<Mutex<Value>>,
    /// Quantos clientes estão conectados
    pub connected_clients: Arc<Mutex<usize>>,
    /// Resource dir do Tauri (pra servir fontes em produção)
    pub resource_dir: Arc<Mutex<String>>,
}

impl BroadcastState {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(100);
        Self {
            tx,
            current_config: Arc::new(Mutex::new(Value::Null)),
            connected_clients: Arc::new(Mutex::new(0)),
            resource_dir: Arc::new(Mutex::new(String::new())),
        }
    }
}

// ─── 3. Adicionar handler de arquivos locais ──────────────────────────────

/// Serve um arquivo do sistema de arquivos local (logo, imagens, etc).
/// Usado pelo OBS pra acessar arquivos que estão em caminhos absolutos.
async fn serve_local_file(Query(params): Query<LocalFileQuery>) -> Response {
    let path = Path::new(&params.path);

    // Validação: só serve arquivos que existem
    if !path.exists() || !path.is_file() {
        return (StatusCode::NOT_FOUND, "File not found").into_response();
    }

    // Detecta MIME type pela extensão
    let mime = match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    };

    // Lê o arquivo
    match fs::read(&path).await {
        Ok(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, mime)
            .header(header::CACHE_CONTROL, "public, max-age=3600")
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(Body::from(bytes))
            .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Build error").into_response()),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, format!("Erro: {e}")).into_response(),
    }
}

// ═════════════════════════════════════════════════════════════════════════
// HANDLE DO SERVIDOR (pra poder parar)
// ═════════════════════════════════════════════════════════════════════════

pub struct ServerHandle {
    pub shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
    pub state: BroadcastState,
    pub url: String,
    pub port: u16,
}

pub type ServerHandleState = Arc<Mutex<Option<ServerHandle>>>;

// ═════════════════════════════════════════════════════════════════════════
// COMANDOS TAURI
// ═════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn start_broadcast_server(
    app: AppHandle<Wry>,
    server_state: TauriState<'_, ServerHandleState>,
    config: Value,
    port: Option<u16>,
) -> Result<BroadcastInfo, String> {
    let mut state_lock = server_state.lock().await;

    // Se já tá rodando, só atualiza o config e retorna info
    if let Some(handle) = state_lock.as_ref() {
        let _ = handle.state.tx.send(config.to_string());
        *handle.state.current_config.lock().await = config.clone();

        return Ok(BroadcastInfo {
            url: handle.url.clone(),
            port: handle.port,
            local_ip: get_local_ip_string(),
            is_running: true,
            connected_clients: *handle.state.connected_clients.lock().await,
        });
    }

    // Cria estado novo
    let bcast = BroadcastState::new();
    *bcast.current_config.lock().await = config.clone();

    // Resolve o resource_dir do Tauri pra servir fontes corretamente
    // em produção (onde caminhos relativos não funcionam).
    if let Ok(res_dir) = app.path().resource_dir() {
        *bcast.resource_dir.lock().await = res_dir.to_string_lossy().to_string();
    }

    let port = port.unwrap_or(7891);

    // Tenta abrir o socket — se a porta estiver ocupada, tenta as próximas
    let (listener, actual_port) = bind_available_port(port)
        .await
        .map_err(|e| format!("Erro ao abrir porta: {e}"))?;

    let local_ip = get_local_ip_string();
    let url = format!("http://{local_ip}:{actual_port}/overlay");

    // Monta o router
    let app_router = Router::new()
        .route("/overlay", get(serve_overlay_page))
        .route("/ws", get(websocket_handler))
        .route("/config", get(get_current_config))
        .route("/status", get(server_status))
        .route("/local-file", get(serve_local_file))
        .route("/fonts/{name}", get(serve_bundled_font))
        .route("/fonts", get(serve_custom_font))
        .layer(CorsLayer::permissive())
        .with_state(bcast.clone());

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    // Spawna o servidor em background
    tokio::spawn(async move {
        let server = axum::serve(listener, app_router);
        tokio::select! {
            _ = server => {},
            _ = shutdown_rx => {
                println!("Servidor de transmissão encerrado.");
            }
        }
    });

    // Notifica o frontend que o servidor está no ar
    let _ = app.emit(
        "broadcast-server-started",
        &serde_json::json!({
            "url": url,
            "port": actual_port,
            "local_ip": local_ip,
        }),
    );

    // Salva o handle pra poder parar depois
    *state_lock = Some(ServerHandle {
        shutdown_tx: Some(shutdown_tx),
        state: bcast.clone(),
        url: url.clone(),
        port: actual_port,
    });

    Ok(BroadcastInfo {
        url,
        port: actual_port,
        local_ip: get_local_ip_string(),
        is_running: true,
        connected_clients: 0,
    })
}

#[tauri::command]
pub async fn stop_broadcast_server(
    app: AppHandle<Wry>,
    server_state: TauriState<'_, ServerHandleState>,
) -> Result<(), String> {
    let mut state_lock = server_state.lock().await;

    if let Some(mut handle) = state_lock.take() {
        if let Some(tx) = handle.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }

    let _ = app.emit("broadcast-server-stopped", ());
    Ok(())
}

#[tauri::command]
pub async fn update_broadcast_config(
    server_state: TauriState<'_, ServerHandleState>,
    config: Value,
) -> Result<(), String> {
    let state_lock = server_state.lock().await;

    if let Some(handle) = state_lock.as_ref() {
        // Atualiza o config armazenado
        *handle.state.current_config.lock().await = config.clone();
        // Manda pros clientes conectados via WebSocket
        let _ = handle.state.tx.send(config.to_string());
    }

    Ok(())
}

#[tauri::command]
pub async fn get_broadcast_info(
    server_state: TauriState<'_, ServerHandleState>,
) -> Result<BroadcastInfo, String> {
    let state_lock = server_state.lock().await;

    if let Some(handle) = state_lock.as_ref() {
        Ok(BroadcastInfo {
            url: handle.url.clone(),
            port: handle.port,
            local_ip: get_local_ip_string(),
            is_running: true,
            connected_clients: *handle.state.connected_clients.lock().await,
        })
    } else {
        Ok(BroadcastInfo {
            url: String::new(),
            port: 0,
            local_ip: get_local_ip_string(),
            is_running: false,
            connected_clients: 0,
        })
    }
}

// ═════════════════════════════════════════════════════════════════════════
// TYPES
// ═════════════════════════════════════════════════════════════════════════

#[derive(Debug, serde::Serialize)]
pub struct BroadcastInfo {
    pub url: String,
    pub port: u16,
    pub local_ip: String,
    pub is_running: bool,
    pub connected_clients: usize,
}

// ═════════════════════════════════════════════════════════════════════════
// HANDLERS HTTP
// ═════════════════════════════════════════════════════════════════════════

/// Serve a página HTML do overlay (com JS embarcado pra conectar no WS)
async fn serve_overlay_page(State(_state): State<BroadcastState>) -> Html<String> {
    Html(OVERLAY_HTML.to_string())
}

/// Retorna o config atual (caso o cliente queira buscar via HTTP em vez de WS)
async fn get_current_config(State(state): State<BroadcastState>) -> impl IntoResponse {
    let config = state.current_config.lock().await.clone();
    axum::Json(config)
}

/// Retorna status do servidor
async fn server_status(State(state): State<BroadcastState>) -> impl IntoResponse {
    let connected = *state.connected_clients.lock().await;
    axum::Json(serde_json::json!({
        "status": "running",
        "connected_clients": connected,
    }))
}

/// Handler do WebSocket — manda updates em tempo real pros clientes
async fn websocket_handler(
    ws: WebSocketUpgrade,
    State(state): State<BroadcastState>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: BroadcastState) {
    let (mut sender, mut receiver) = socket.split();

    // Incrementa contador de clientes
    {
        let mut count = state.connected_clients.lock().await;
        *count += 1;
    }

    // Manda config atual pro cliente que acabou de conectar
    let initial = state.current_config.lock().await.clone();
    if let Ok(msg) = serde_json::to_string(&initial) {
        let _ = sender.send(Message::Text(msg.into())).await;
    }

    // Inscreve o cliente no canal de broadcast
    let mut rx = state.tx.subscribe();

    // Task pra mandar updates do canal pro cliente
    let send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if sender.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    // Task pra receber pings/close do cliente
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            if let Message::Close(_) = msg {
                break;
            }
        }
    });

    // Aguarda qualquer task terminar
    tokio::select! {
        _ = send_task => {},
        _ = recv_task => {},
    }

    // Decrementa contador
    {
        let mut count = state.connected_clients.lock().await;
        if *count > 0 {
            *count -= 1;
        }
    }
}

// ═════════════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════════════

fn get_local_ip_string() -> String {
    local_ip()
        .map(|ip| match ip {
            IpAddr::V4(v4) => v4.to_string(),
            IpAddr::V6(v6) => v6.to_string(),
        })
        .unwrap_or_else(|_| "127.0.0.1".to_string())
}

/// Tenta abrir uma porta — se ocupada, tenta as próximas até achar uma livre
async fn bind_available_port(start_port: u16) -> Result<(tokio::net::TcpListener, u16), String> {
    for offset in 0..20 {
        let port = start_port + offset;
        let addr = SocketAddr::from(([0, 0, 0, 0], port));
        match tokio::net::TcpListener::bind(addr).await {
            Ok(listener) => return Ok((listener, port)),
            Err(_) => continue,
        }
    }
    Err(format!(
        "Nenhuma porta disponível entre {} e {}",
        start_port,
        start_port + 20
    ))
}

// ═════════════════════════════════════════════════════════════════════════
// HTML DO OVERLAY (embarcado no binário)
// ─────────────────────────────────────────────────────────────────────────
// Esta página é carregada pelo OBS via Browser Source. Conecta no
// WebSocket e renderiza os overlays sobre fundo transparente.
// ═════════════════════════════════════════════════════════════════════════

const OVERLAY_HTML: &str = include_str!("../resources/broadcast-overlay.html");
