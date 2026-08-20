// TNR Dev Client shell: a thin Tauri v2 host that manages the lifecycle of
// the compiled Bun sidecar. All game logic lives in the sidecar; the UI talks
// to it over loopback HTTP.

use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::Manager;

struct SidecarState {
    child: Mutex<Option<Child>>,
    // Shared secret the sidecar requires on every request. Minted once per app
    // launch and handed to the UI, so that a web page the user visits cannot
    // drive the loopback API even though it can reach the port.
    auth_token: String,
}

impl Default for SidecarState {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            auth_token: std::env::var("TNR_DEV_CLIENT_AUTH_TOKEN").unwrap_or_else(|_| {
                format!(
                    "{}{}",
                    uuid::Uuid::new_v4().simple(),
                    uuid::Uuid::new_v4().simple()
                )
            }),
        }
    }
}

#[derive(serde::Serialize)]
struct SidecarInfo {
    running: bool,
    port: u16,
    #[serde(rename = "authToken")]
    auth_token: String,
}

const DEFAULT_PORT: u16 = 49200;

fn sidecar_port() -> u16 {
    std::env::var("TNR_DEV_CLIENT_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(DEFAULT_PORT)
}

// In development the binary is built to ../bin via `bun run sidecar:build` and
// pointed at with TNR_DEV_CLIENT_SIDECAR. In release it is bundled as a
// resource.
fn sidecar_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    if let Ok(path) = std::env::var("TNR_DEV_CLIENT_SIDECAR") {
        return Ok(std::path::PathBuf::from(path));
    }
    let dir = app
        .path()
        .resolve("", tauri::path::BaseDirectory::Resource)
        .map_err(|error| error.to_string())?;
    let path = dir.join("tnr-dev-client");
    #[cfg(windows)]
    let path = path.with_extension("exe");
    Ok(path)
}

fn lock_state(state: &SidecarState) -> Result<std::sync::MutexGuard<'_, Option<Child>>, String> {
    state
        .child
        .lock()
        .map_err(|_| "sidecar state lock is poisoned".to_string())
}

fn info(running: bool, auth_token: &str) -> SidecarInfo {
    SidecarInfo {
        running,
        port: sidecar_port(),
        auth_token: auth_token.to_string(),
    }
}

/// Starts the sidecar if it is not running yet (idempotent). If the tracked
/// child has exited in the meantime it is reaped and a new one is spawned.
#[tauri::command]
fn start_sidecar(
    app: tauri::AppHandle,
    state: tauri::State<'_, SidecarState>,
) -> Result<SidecarInfo, String> {
    let port = sidecar_port();
    let token = state.auth_token.clone();
    let mut guard = lock_state(&state)?;

    if let Some(child) = guard.as_mut() {
        match child.try_wait() {
            Ok(Some(_)) => *guard = None, // exited; fall through and restart
            Ok(None) => return Ok(info(true, &token)),
            Err(_) => {
                *guard = None;
            }
        }
    }

    let path = sidecar_path(&app)?;
    let child = Command::new(&path)
        .env("TNR_DEV_CLIENT_PORT", port.to_string())
        .env("TNR_DEV_CLIENT_AUTH_TOKEN", &token)
        .spawn()
        .map_err(|error| {
            format!(
                "failed to start sidecar at {}: {}",
                path.display(),
                error
            )
        })?;
    *guard = Some(child);
    Ok(info(true, &token))
}

#[tauri::command]
fn stop_sidecar(state: tauri::State<'_, SidecarState>) -> Result<SidecarInfo, String> {
    let mut guard = lock_state(&state)?;
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(info(false, &state.auth_token))
}

#[tauri::command]
fn sidecar_info(state: tauri::State<'_, SidecarState>) -> Result<SidecarInfo, String> {
    let mut guard = lock_state(&state)?;
    // try_wait reaps a child that has already exited, so a crashed sidecar is
    // reported as stopped rather than lingering as "running" forever.
    let running = match guard.as_mut() {
        Some(child) => match child.try_wait() {
            Ok(Some(_)) | Err(_) => {
                *guard = None;
                false
            }
            Ok(None) => true,
        },
        None => false,
    };
    Ok(info(running, &state.auth_token))
}

/// Open an external URL in the user's default browser.
///
/// A `target="_blank"` anchor does nothing in a Tauri webview, so the UI routes
/// outbound links here. Only http(s) is accepted, so the UI cannot be tricked
/// into launching arbitrary schemes.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("only http(s) URLs may be opened".to_string());
    }
    #[cfg(target_os = "macos")]
    let (program, args): (&str, Vec<&str>) = ("open", vec![]);
    #[cfg(target_os = "windows")]
    let (program, args): (&str, Vec<&str>) = ("cmd", vec!["/C", "start", ""]);
    #[cfg(all(unix, not(target_os = "macos")))]
    let (program, args): (&str, Vec<&str>) = ("xdg-open", vec![]);

    Command::new(program)
        .args(args)
        .arg(&url)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn main() {
    tauri::Builder::default()
        .manage(SidecarState::default())
        .invoke_handler(tauri::generate_handler![
            start_sidecar,
            stop_sidecar,
            sidecar_info,
            open_external
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // The sidecar holds the device token and can run agents on its own,
            // so it must never outlive the window that supervises it.
            if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<SidecarState>() {
                    if let Ok(mut guard) = state.child.lock() {
                        if let Some(mut child) = guard.take() {
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                    }
                }
            }
        });
}
