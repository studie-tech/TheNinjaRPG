// TNR Dev Client shell: a thin Tauri v2 host that manages the lifecycle of
// the compiled Bun sidecar. All game logic lives in the sidecar; the UI talks
// to it over loopback HTTP.

use std::process::{Child, Command};
use std::sync::Mutex;

#[derive(Default)]
struct SidecarState {
    child: Mutex<Option<Child>>,
}

#[derive(serde::Serialize)]
struct SidecarInfo {
    running: bool,
    port: u16,
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
    let mut path = dir.join("tnr-dev-client");
    #[cfg(windows)]
    path.set_extension("exe");
    Ok(path)
}

fn lock_state(state: &SidecarState) -> Result<std::sync::MutexGuard<'_, Option<Child>>, String> {
    state
        .child
        .lock()
        .map_err(|_| "sidecar state lock is poisoned".to_string())
}

/// Starts the sidecar if it is not running yet (idempotent). If the tracked
/// child has exited in the meantime it is reaped and a new one is spawned.
#[tauri::command]
fn start_sidecar(
    app: tauri::AppHandle,
    state: tauri::State<'_, SidecarState>,
) -> Result<SidecarInfo, String> {
    let port = sidecar_port();
    let mut guard = lock_state(&state)?;

    if let Some(child) = guard.as_mut() {
        match child.try_wait() {
            Ok(Some(_)) => *guard = None, // exited; fall through and restart
            Ok(None) => return Ok(SidecarInfo { running: true, port }),
            Err(_) => {
                *guard = None;
            }
        }
    }

    let path = sidecar_path(&app)?;
    let child = Command::new(&path)
        .env("TNR_DEV_CLIENT_PORT", port.to_string())
        .spawn()
        .map_err(|error| {
            format!(
                "failed to start sidecar at {}: {}",
                path.display(),
                error
            )
        })?;
    *guard = Some(child);
    Ok(SidecarInfo { running: true, port })
}

#[tauri::command]
fn stop_sidecar(state: tauri::State<'_, SidecarState>) -> Result<SidecarInfo, String> {
    let mut guard = lock_state(&state)?;
    if let Some(child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(SidecarInfo {
        running: false,
        port: sidecar_port(),
    })
}

#[tauri::command]
fn sidecar_info(state: tauri::State<'_, SidecarState>) -> Result<SidecarInfo, String> {
    let guard = lock_state(&state)?;
    Ok(SidecarInfo {
        running: guard.is_some(),
        port: sidecar_port(),
    })
}

fn main() {
    tauri::Builder::default()
        .manage(SidecarState::default())
        .invoke_handler(tauri::generate_handler![
            start_sidecar,
            stop_sidecar,
            sidecar_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
