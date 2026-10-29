// src-tauri/src/google_auth/google_auth.rs
//
// Login com Google no DESKTOP abrindo o navegador principal do sistema.
//
// Por que não usar o botão do Google (GIS) dentro do app?
//   O Google bloqueia OAuth em webviews embarcados (erro "disallowed_useragent").
//   O fluxo correto para apps desktop é o LOOPBACK (RFC 8252):
//
//   1. O app sobe um servidor temporário em http://127.0.0.1:<porta aleatória>
//   2. Abre o navegador padrão em  {backend}/api/login/google/desktop?port=<porta>
//   3. O backend faz o OAuth com o Google (o client_secret fica SÓ no backend)
//   4. No fim, o backend redireciona o navegador para
//        http://127.0.0.1:<porta>/callback?token=<JWT do Sigelo>
//   5. Este servidor captura o token, mostra "pode fechar esta aba" e devolve
//      o token para o frontend. O servidor é encerrado em seguida.
//
// Registro (lib.rs):
//   mod google_auth;   (pasta google_auth/ com mod.rs)
//   .plugin(tauri_plugin_opener::init())            // obrigatório (abre o navegador)
//   .invoke_handler(tauri::generate_handler![ ..., crate::google_auth::google_auth::google_login ])
//
// Dependências: usa axum + tokio + tauri-plugin-opener, que já estão no Cargo.toml.

use axum::{extract::Query, response::Html, routing::get, Router};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use tokio::sync::oneshot;

/// Tempo máximo esperando o usuário concluir o login no navegador.
const LOGIN_TIMEOUT_SECS: u64 = 300;

const PAGE_OK: &str = r#"<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Sigelo — Login concluído</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;text-align:center;padding-top:80px;color:#222">
<h2>Login concluído ✅</h2>
<p>Você já pode voltar ao <b>Sigelo</b>. Esta aba pode ser fechada.</p>
<script>setTimeout(function(){ window.close(); }, 1500);</script>
</body></html>"#;

const PAGE_ERR: &str = r#"<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Sigelo — Falha no login</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;text-align:center;padding-top:80px;color:#222">
<h2>Não foi possível concluir o login</h2>
<p>Volte ao <b>Sigelo</b> e tente novamente.</p>
</body></html>"#;

type TokenSender = Arc<Mutex<Option<oneshot::Sender<Result<String, String>>>>>;

#[tauri::command]
pub async fn google_login(app: AppHandle, backend_base: String) -> Result<String, String> {
    // 1) Porta aleatória livre, SÓ no loopback (não fica exposto na rede)
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Não foi possível iniciar o retorno do login: {}", e))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    // Canal que entrega o resultado do callback para este comando
    let (token_tx, token_rx) = oneshot::channel::<Result<String, String>>();
    let token_tx: TokenSender = Arc::new(Mutex::new(Some(token_tx)));

    // 2) Rota /callback — o backend redireciona o navegador para cá
    let tx_route = token_tx.clone();
    let router = Router::new().route(
        "/callback",
        get(move |Query(params): Query<HashMap<String, String>>| {
            let tx_route = tx_route.clone();
            async move {
                let result = match (params.get("token"), params.get("error")) {
                    (Some(t), _) if !t.is_empty() => Ok(t.clone()),
                    (_, Some(e)) => Err(e.clone()),
                    _ => Err("Resposta de login inválida.".to_string()),
                };
                let ok = result.is_ok();
                // Só o primeiro callback vale (take() esvazia o Option)
                if let Some(tx) = tx_route.lock().unwrap().take() {
                    let _ = tx.send(result);
                }
                Html(if ok { PAGE_OK } else { PAGE_ERR })
            }
        }),
    );

    // Servidor com desligamento gracioso (entrega a página antes de fechar)
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await;
    });

    // 3) Abre o navegador PRINCIPAL do sistema no início do OAuth
    let auth_url = format!(
        "{}/api/login/google/desktop?port={}",
        backend_base.trim_end_matches('/'),
        port
    );
    if let Err(e) = app.opener().open_url(auth_url, None::<&str>) {
        let _ = shutdown_tx.send(());
        return Err(format!("Não foi possível abrir o navegador: {}", e));
    }

    // 4) Aguarda o callback (com timeout) e encerra o servidor
    let outcome = tokio::time::timeout(Duration::from_secs(LOGIN_TIMEOUT_SECS), token_rx).await;
    let _ = shutdown_tx.send(());

    match outcome {
        Err(_) => Err("Tempo esgotado aguardando o login no navegador.".to_string()),
        Ok(Err(_)) => Err("Login cancelado.".to_string()),
        Ok(Ok(result)) => result,
    }
}
