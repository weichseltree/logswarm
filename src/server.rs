//! HTTP and WebSocket server for the logswarm dashboard.
//!
//! Serves the static dashboard build, a health-check endpoint, auth stubs,
//! and a WebSocket endpoint for real-time data streaming.

use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::{IntoResponse, Json};
use axum::routing::get;
use axum::Router;
use serde_json::json;
use tokio::signal;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

use crate::config::Config;

/// Shared application state.
struct AppState {
    start_time: Instant,
    config: Config,
}

/// Start the HTTP/WebSocket server.
///
/// This function blocks until a shutdown signal (SIGTERM or SIGINT) is received.
pub async fn run(config: Config) -> Result<(), Box<dyn std::error::Error>> {
    let bind_addr: SocketAddr = config.service.dashboard_bind.parse()?;
    let dashboard_dir = config.service.dashboard_dir.clone();

    let state = Arc::new(AppState {
        start_time: Instant::now(),
        config,
    });

    // Build the router
    let mut app = Router::new()
        .route("/healthz", get(healthz))
        .route("/ws", get(ws_upgrade))
        .route("/auth/challenge", get(auth_challenge))
        .route("/auth/verify", axum::routing::post(auth_verify))
        .layer(CorsLayer::permissive())
        .with_state(state);

    // Serve static dashboard files if the directory exists
    let dashboard_path = Path::new(&dashboard_dir);
    if dashboard_path.exists() && dashboard_path.is_dir() {
        let serve_dir = ServeDir::new(&dashboard_dir).append_index_html_on_directories(true);
        app = app.fallback_service(serve_dir);
        println!("logswarm: serving dashboard from {dashboard_dir}");
    } else {
        println!("logswarm: dashboard dir not found at {dashboard_dir} — skipping static serving");
    }

    let listener = tokio::net::TcpListener::bind(bind_addr).await?;
    println!("logswarm: listening on http://{bind_addr}");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    println!("logswarm: server shut down gracefully");
    Ok(())
}

// ── Health check ────────────────────────────────────────────────────────

async fn healthz(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let uptime = state.start_time.elapsed().as_secs();
    Json(json!({
        "status": "ok",
        "uptime_s": uptime,
        "workers": state.config.swarm.workers,
    }))
}

// ── WebSocket ───────────────────────────────────────────────────────────

async fn ws_upgrade(
    ws: WebSocketUpgrade,
    State(_state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(handle_ws)
}

async fn handle_ws(mut socket: WebSocket) {
    // Echo loop — will be replaced by stream dispatch when agents are implemented
    while let Some(Ok(msg)) = socket.recv().await {
        match msg {
            Message::Binary(data) => {
                if socket.send(Message::Binary(data)).await.is_err() {
                    break;
                }
            }
            Message::Text(text) => {
                if socket.send(Message::Text(text)).await.is_err() {
                    break;
                }
            }
            Message::Ping(ping) => {
                if socket.send(Message::Pong(ping)).await.is_err() {
                    break;
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }
}

// ── Auth stubs ──────────────────────────────────────────────────────────

async fn auth_challenge() -> impl IntoResponse {
    let nonce = uuid::Uuid::new_v4().to_string();
    Json(json!({ "challenge": nonce }))
}

async fn auth_verify(
    axum::extract::Json(_body): axum::extract::Json<serde_json::Value>,
) -> impl IntoResponse {
    // Stub: accept all devices for now
    let device_id = uuid::Uuid::new_v4().to_string();
    let token = format!("stub-jwt-{device_id}");
    Json(json!({
        "token": token,
        "device_id": device_id,
    }))
}

// ── Graceful shutdown ───────────────────────────────────────────────────

async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => println!("\nlogswarm: received Ctrl+C"),
        _ = terminate => println!("logswarm: received SIGTERM"),
    }
}
