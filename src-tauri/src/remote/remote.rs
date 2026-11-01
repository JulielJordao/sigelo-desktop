// ═════════════════════════════════════════════════════════════════════════
// CONTROLE REMOTO — Servidor na rede local para o celular controlar a projeção
// ─────────────────────────────────────────────────────────────────────────
// O celular (mesmo Wi-Fi) abre a página servida aqui, pareia com o QR code
// ou com o código de 6 dígitos e passa a controlar slides, versículos,
// vídeos, músicas e programações.
//
//   Celular ──(WebSocket)──► este servidor ──(evento "remote-command")──► Vue
//   Vue ──(invoke publish_remote_message)──► este servidor ──► celulares
//
// O Rust só autentica e repassa mensagens; quem executa os comandos e monta
// o estado é o frontend (stores/remoteControlStore.ts).
//
// Rotas:
//   GET /            → página de controle (HTML embarcado)
//   GET /pair?pin=   → troca o código de 6 dígitos pelo token  { token }
//   GET /check?token=→ { valid }  (a página usa para saber se precisa parear de novo)
//   GET /ws?token=   → WebSocket (exige token)
//   GET /status      → { status, connectedClients }
// ═════════════════════════════════════════════════════════════════════════

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        DefaultBodyLimit, Query, State,
    },
    body::Bytes,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use futures_util::{sink::SinkExt, stream::StreamExt};
use local_ip_address::local_ip;
use serde_json::{json, Value};
use aes_gcm::aead::{rand_core::RngCore, OsRng};
use std::{
    net::{IpAddr, SocketAddr},
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, State as TauriState, Wry};
use tokio::sync::{broadcast, Mutex};
use tower_http::cors::CorsLayer;

const REMOTE_HTML: &str = include_str!("../resources/remote-control.html");
const DEFAULT_PORT: u16 = 7900;
/// Depois de tantas tentativas erradas de código, bloqueia por LOCK_SECONDS.
const MAX_FAILED_ATTEMPTS: u32 = 8;
const LOCK_SECONDS: u64 = 60;
/// Tamanho máximo do PDF enviado pelo celular.
const MAX_PDF_BYTES: usize = 150 * 1024 * 1024;

// ═════════════════════════════════════════════════════════════════════════
// ESTADO
// ═════════════════════════════════════════════════════════════════════════

#[derive(Clone)]
pub struct RemoteState {
    tx: broadcast::Sender<String>,
    /// Último "state" publicado — enviado a quem acabou de conectar.
    last_state: Arc<Mutex<Option<String>>>,
    token: Arc<Mutex<String>>,
    pin: Arc<Mutex<String>>,
    clients: Arc<Mutex<usize>>,
    /// (tentativas erradas, bloqueado até)
    failures: Arc<Mutex<(u32, Option<Instant>)>>,
    /// PDF enviado pelo celular, aguardando o frontend buscar (nome, bytes).
    pending_pdf: Arc<Mutex<Option<(String, Vec<u8>)>>>,
    app: AppHandle<Wry>,
}

pub struct RemoteServerHandle {
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
    state: RemoteState,
    port: u16,
}

pub type RemoteServerState = Arc<Mutex<Option<RemoteServerHandle>>>;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub is_running: bool,
    /// Endereço para digitar no navegador do celular.
    pub url: String,
    /// Endereço com o token (vai no QR code).
    pub pairing_url: String,
    pub pin: String,
    pub token: String,
    /// QR code do pairing_url, em SVG.
    pub qr_svg: String,
    pub port: u16,
    pub local_ip: String,
    pub connected_clients: usize,
}

impl RemoteInfo {
    fn stopped() -> Self {
        RemoteInfo {
            is_running: false,
            url: String::new(),
            pairing_url: String::new(),
            pin: String::new(),
            token: String::new(),
            qr_svg: String::new(),
            port: 0,
            local_ip: get_local_ip_string(),
            connected_clients: 0,
        }
    }
}

// ═════════════════════════════════════════════════════════════════════════
// COMANDOS TAURI
// ═════════════════════════════════════════════════════════════════════════

/// Liga o servidor. `token`/`pin` salvos (opcional) mantêm os celulares já
/// pareados entre uma sessão e outra; sem eles, gera novos.
#[tauri::command]
pub async fn start_remote_server(
    app: AppHandle<Wry>,
    server_state: TauriState<'_, RemoteServerState>,
    port: Option<u16>,
    token: Option<String>,
    pin: Option<String>,
) -> Result<RemoteInfo, String> {
    let mut lock = server_state.lock().await;
    if let Some(handle) = lock.as_ref() {
        return Ok(info_for(handle).await);
    }

    let token = token.filter(|t| t.len() >= 16).unwrap_or_else(new_token);
    let pin = pin.filter(|p| p.len() == 6 && p.chars().all(|c| c.is_ascii_digit())).unwrap_or_else(new_pin);

    let (tx, _) = broadcast::channel(256);
    let state = RemoteState {
        tx,
        last_state: Arc::new(Mutex::new(None)),
        token: Arc::new(Mutex::new(token)),
        pin: Arc::new(Mutex::new(pin)),
        clients: Arc::new(Mutex::new(0)),
        failures: Arc::new(Mutex::new((0, None))),
        pending_pdf: Arc::new(Mutex::new(None)),
        app: app.clone(),
    };

    let (listener, actual_port) = bind_available_port(port.unwrap_or(DEFAULT_PORT))
        .await
        .map_err(|e| format!("Erro ao abrir porta: {e}"))?;

    let router = Router::new()
        .route("/", get(serve_page))
        .route("/remote", get(serve_page))
        .route("/pair", get(pair_handler))
        .route("/check", get(check_handler))
        .route("/ws", get(ws_handler))
        .route("/status", get(status_handler))
        .route(
            "/upload-pdf",
            post(upload_pdf_handler).layer(DefaultBodyLimit::max(MAX_PDF_BYTES)),
        )
        .layer(CorsLayer::permissive())
        .with_state(state.clone());

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    tokio::spawn(async move {
        let server = axum::serve(listener, router);
        tokio::select! {
            _ = server => {},
            _ = shutdown_rx => {
                println!("Servidor de controle remoto encerrado.");
            }
        }
    });

    let handle = RemoteServerHandle {
        shutdown_tx: Some(shutdown_tx),
        state,
        port: actual_port,
    };
    let info = info_for(&handle).await;
    *lock = Some(handle);

    let _ = app.emit("remote-server-started", &info);
    Ok(info)
}

#[tauri::command]
pub async fn stop_remote_server(
    app: AppHandle<Wry>,
    server_state: TauriState<'_, RemoteServerState>,
) -> Result<(), String> {
    let mut lock = server_state.lock().await;
    if let Some(mut handle) = lock.take() {
        // Avisa os celulares antes de desligar.
        let _ = handle.state.tx.send(json!({ "type": "server-stopped" }).to_string());
        if let Some(tx) = handle.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }
    let _ = app.emit("remote-server-stopped", ());
    Ok(())
}

#[tauri::command]
pub async fn get_remote_info(
    server_state: TauriState<'_, RemoteServerState>,
) -> Result<RemoteInfo, String> {
    let lock = server_state.lock().await;
    Ok(match lock.as_ref() {
        Some(handle) => info_for(handle).await,
        None => RemoteInfo::stopped(),
    })
}

/// Gera novo código/QR e desconecta todos os celulares pareados.
#[tauri::command]
pub async fn regenerate_remote_pairing(
    server_state: TauriState<'_, RemoteServerState>,
) -> Result<RemoteInfo, String> {
    let lock = server_state.lock().await;
    let Some(handle) = lock.as_ref() else {
        return Err("O controle remoto não está ligado.".into());
    };
    *handle.state.token.lock().await = new_token();
    *handle.state.pin.lock().await = new_pin();
    *handle.state.failures.lock().await = (0, None);
    let _ = handle.state.tx.send(json!({ "type": "revoked" }).to_string());
    Ok(info_for(handle).await)
}

/// O frontend publica mensagens para todos os celulares conectados
/// ("state", respostas de listas etc.). O último "state" fica guardado.
#[tauri::command]
pub async fn publish_remote_message(
    server_state: TauriState<'_, RemoteServerState>,
    message: Value,
) -> Result<(), String> {
    let lock = server_state.lock().await;
    if let Some(handle) = lock.as_ref() {
        let text = message.to_string();
        if message.get("type").and_then(|t| t.as_str()) == Some("state") {
            *handle.state.last_state.lock().await = Some(text.clone());
        }
        let _ = handle.state.tx.send(text);
    }
    Ok(())
}

/// Entrega ao frontend o PDF que o celular enviou (bytes crus → ArrayBuffer no JS).
#[tauri::command]
pub async fn take_remote_pdf(
    server_state: TauriState<'_, RemoteServerState>,
) -> Result<tauri::ipc::Response, String> {
    let lock = server_state.lock().await;
    let Some(handle) = lock.as_ref() else {
        return Err("O controle remoto não está ligado.".into());
    };
    let pending = handle.state.pending_pdf.lock().await.take();
    match pending {
        Some((_, data)) => Ok(tauri::ipc::Response::new(data)),
        None => Err("Nenhum PDF recebido.".into()),
    }
}

// ═════════════════════════════════════════════════════════════════════════
// HANDLERS HTTP
// ═════════════════════════════════════════════════════════════════════════

async fn serve_page() -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .body(axum::body::Body::from(REMOTE_HTML))
        .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Build error").into_response())
}

#[derive(serde::Deserialize)]
struct PairQuery {
    pin: Option<String>,
}

async fn pair_handler(Query(q): Query<PairQuery>, State(state): State<RemoteState>) -> Response {
    if is_locked(&state).await {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            axum::Json(json!({ "error": "Muitas tentativas. Aguarde 1 minuto e tente de novo." })),
        )
            .into_response();
    }
    let pin = state.pin.lock().await.clone();
    let typed = q.pin.unwrap_or_default();
    if !typed.is_empty() && typed.trim() == pin {
        *state.failures.lock().await = (0, None);
        let token = state.token.lock().await.clone();
        return axum::Json(json!({ "token": token })).into_response();
    }
    register_failure(&state).await;
    (
        StatusCode::UNAUTHORIZED,
        axum::Json(json!({ "error": "Código incorreto. Confira o código na tela do computador." })),
    )
        .into_response()
}

#[derive(serde::Deserialize)]
struct TokenQuery {
    token: Option<String>,
}

async fn check_handler(Query(q): Query<TokenQuery>, State(state): State<RemoteState>) -> Response {
    let token = state.token.lock().await.clone();
    let valid = q.token.map(|t| !t.is_empty() && t == token).unwrap_or(false);
    axum::Json(json!({ "valid": valid })).into_response()
}

#[derive(serde::Deserialize)]
struct UploadQuery {
    token: Option<String>,
    name: Option<String>,
}

/// POST /upload-pdf?token=&name= — corpo: o arquivo PDF.
/// Guarda em memória e avisa o frontend, que abre e projeta.
async fn upload_pdf_handler(
    Query(q): Query<UploadQuery>,
    State(state): State<RemoteState>,
    body: Bytes,
) -> Response {
    let token = state.token.lock().await.clone();
    if q.token.as_deref().map(|t| t.is_empty() || t != token).unwrap_or(true) {
        return (StatusCode::UNAUTHORIZED, axum::Json(json!({ "error": "Não pareado." }))).into_response();
    }
    // Assinatura do PDF ("%PDF-") no começo do arquivo.
    let head = &body[..body.len().min(1024)];
    if !head.windows(5).any(|w| w == b"%PDF-") {
        return (StatusCode::BAD_REQUEST, axum::Json(json!({ "error": "O arquivo não é um PDF." }))).into_response();
    }

    let mut name: String = q
        .name
        .unwrap_or_default()
        .chars()
        .filter(|c| !c.is_control() && *c != '/' && *c != '\\')
        .take(120)
        .collect();
    if name.trim().is_empty() {
        name = "PDF do celular.pdf".into();
    }
    let size = body.len();
    *state.pending_pdf.lock().await = Some((name.clone(), body.to_vec()));
    let _ = state.app.emit("remote-pdf-received", json!({ "name": name, "size": size }));
    axum::Json(json!({ "ok": true, "name": name, "size": size })).into_response()
}

async fn status_handler(State(state): State<RemoteState>) -> Response {
    let clients = *state.clients.lock().await;
    axum::Json(json!({ "status": "running", "connectedClients": clients })).into_response()
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(q): Query<TokenQuery>,
    State(state): State<RemoteState>,
) -> Response {
    let token = state.token.lock().await.clone();
    let valid = q.token.map(|t| !t.is_empty() && t == token).unwrap_or(false);
    if !valid {
        return (StatusCode::UNAUTHORIZED, "Pareamento inválido").into_response();
    }
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: RemoteState) {
    let (mut sender, mut receiver) = socket.split();

    let count = {
        let mut clients = state.clients.lock().await;
        *clients += 1;
        *clients
    };
    let _ = state.app.emit("remote-clients-changed", count);

    // Boas-vindas + último estado conhecido
    let hello = json!({ "type": "hello", "server": "sigelo-desktop" }).to_string();
    let _ = sender.send(Message::Text(hello.into())).await;
    let last = state.last_state.lock().await.clone();
    if let Some(last) = last {
        let _ = sender.send(Message::Text(last.into())).await;
    }
    // Pede ao frontend um estado fresco (lista de programações etc.)
    let _ = state.app.emit("remote-command", json!({ "type": "command", "action": "sync" }));

    let mut rx = state.tx.subscribe();
    let send_task = tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(msg) => {
                    let close = msg.contains("\"type\":\"revoked\"")
                        || msg.contains("\"type\":\"server-stopped\"");
                    if sender.send(Message::Text(msg.into())).await.is_err() {
                        break;
                    }
                    if close {
                        let _ = sender.send(Message::Close(None)).await;
                        break;
                    }
                }
                // Cliente lento perdeu mensagens antigas: segue com as novas.
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    let app = state.app.clone();
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Text(text) => {
                    if let Ok(value) = serde_json::from_str::<Value>(text.as_str()) {
                        if value.get("type").and_then(|t| t.as_str()) == Some("command") {
                            let _ = app.emit("remote-command", value);
                        }
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    tokio::select! {
        _ = send_task => {},
        _ = recv_task => {},
    }

    let count = {
        let mut clients = state.clients.lock().await;
        if *clients > 0 {
            *clients -= 1;
        }
        *clients
    };
    let _ = state.app.emit("remote-clients-changed", count);
}

// ═════════════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════════════

async fn info_for(handle: &RemoteServerHandle) -> RemoteInfo {
    let ip = get_local_ip_string();
    let url = format!("http://{ip}:{}/", handle.port);
    let token = handle.state.token.lock().await.clone();
    let pin = handle.state.pin.lock().await.clone();
    let pairing_url = format!("{url}?k={token}");
    RemoteInfo {
        is_running: true,
        qr_svg: qr_svg(&pairing_url),
        url,
        pairing_url,
        pin,
        token,
        port: handle.port,
        local_ip: ip,
        connected_clients: *handle.state.clients.lock().await,
    }
}

async fn is_locked(state: &RemoteState) -> bool {
    let mut failures = state.failures.lock().await;
    match failures.1 {
        Some(until) if Instant::now() < until => true,
        Some(_) => {
            *failures = (0, None);
            false
        }
        None => false,
    }
}

async fn register_failure(state: &RemoteState) {
    let mut failures = state.failures.lock().await;
    failures.0 += 1;
    if failures.0 >= MAX_FAILED_ATTEMPTS {
        failures.1 = Some(Instant::now() + Duration::from_secs(LOCK_SECONDS));
    }
}

/// Aleatório criptográfico do sistema operacional (o `aes-gcm` já usado no
/// projeto expõe o OsRng — nenhuma dependência nova).
fn random_u64() -> u64 {
    OsRng.next_u64()
}

/// Token de 128 bits (vai no QR code e autentica o WebSocket).
fn new_token() -> String {
    let mut bytes = [0u8; 16];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn new_pin() -> String {
    format!("{:06}", random_u64() % 1_000_000)
}

fn qr_svg(data: &str) -> String {
    use qrcode::render::svg;
    match qrcode::QrCode::new(data.as_bytes()) {
        Ok(code) => code
            .render::<svg::Color>()
            .min_dimensions(220, 220)
            .dark_color(svg::Color("#000000"))
            .light_color(svg::Color("#ffffff"))
            .build(),
        Err(_) => String::new(),
    }
}

fn get_local_ip_string() -> String {
    local_ip()
        .map(|ip| match ip {
            IpAddr::V4(v4) => v4.to_string(),
            IpAddr::V6(v6) => v6.to_string(),
        })
        .unwrap_or_else(|_| "127.0.0.1".to_string())
}

/// Tenta abrir a porta — se ocupada, tenta as próximas.
async fn bind_available_port(start_port: u16) -> Result<(tokio::net::TcpListener, u16), String> {
    for offset in 0..20 {
        let port = start_port + offset;
        let addr = SocketAddr::from(([0, 0, 0, 0], port));
        if let Ok(listener) = tokio::net::TcpListener::bind(addr).await {
            return Ok((listener, port));
        }
    }
    Err(format!(
        "Nenhuma porta disponível entre {} e {}",
        start_port,
        start_port + 20
    ))
}
