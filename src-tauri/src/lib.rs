use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, RunEvent};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

struct BackendChild(Mutex<Option<Child>>);

impl BackendChild {
    fn stop(&self) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(mut child) = guard.take() {
                #[cfg(target_os = "windows")]
                {
                    let pid = child.id();
                    let _ = Command::new("taskkill")
                        .args(["/F", "/T", "/PID", &pid.to_string()])
                        .creation_flags(CREATE_NO_WINDOW)
                        .output();
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    }
}

fn pick_port() -> u16 {
    if TcpListener::bind(("127.0.0.1", 8123)).is_ok() {
        return 8123;
    }
    TcpListener::bind(("127.0.0.1", 0))
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(8123)
}

fn check_health(port: u16) -> bool {
    let addr = format!("127.0.0.1:{port}");
    let Ok(mut stream) = TcpStream::connect_timeout(
        &addr.parse().expect("valid localhost addr"),
        Duration::from_millis(300),
    ) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let req = format!("GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 256];
    match stream.read(&mut buf) {
        Ok(n) if n > 0 => {
            let head = String::from_utf8_lossy(&buf[..n]);
            head.starts_with("HTTP/1.1 200") || head.starts_with("HTTP/1.0 200")
        }
        _ => false,
    }
}

fn wait_for_backend(port: u16, timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if check_health(port) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

fn spawn_backend(app: &tauri::AppHandle, port: u16) -> Option<Child> {
    let data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("data"));
    let _ = std::fs::create_dir_all(&data_dir);

    if cfg!(debug_assertions) {
        // In dev, if backend is already running on 8123 (e.g. via ./run.sh), reuse it.
        if check_health(8123) {
            return None;
        }
        let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(".."));
        let backend_dir = repo_root.join("backend");
        let python = if cfg!(target_os = "windows") {
            let py_venv = backend_dir.join(".venv").join("Scripts").join("python.exe");
            if py_venv.exists() {
                py_venv
            } else {
                PathBuf::from("python")
            }
        } else {
            let py_venv = backend_dir.join(".venv").join("bin").join("python");
            if py_venv.exists() {
                py_venv
            } else {
                PathBuf::from("python3")
            }
        };
        let mut cmd = Command::new(python);
        cmd.arg(backend_dir.join("run_server.py"))
            .arg("--port")
            .arg(port.to_string())
            .current_dir(&backend_dir);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);
        return cmd.spawn().ok();
    }

    // Release mode: look for bundled suhbatdosh-backend(.exe) next to executable or in resources.
    let sidecar_name = if cfg!(target_os = "windows") {
        "suhbatdosh-backend.exe"
    } else {
        "suhbatdosh-backend"
    };

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."));

    let mut candidate_paths = vec![
        exe_dir.join(sidecar_name),
        exe_dir.join("binaries").join(sidecar_name),
    ];

    if let Ok(res_dir) = app.path().resource_dir() {
        candidate_paths.push(res_dir.join(sidecar_name));
        candidate_paths.push(res_dir.join("binaries").join(sidecar_name));
    }

    let sidecar_path = candidate_paths.into_iter().find(|p| p.is_file())?;
    let mut cmd = Command::new(sidecar_path);
    cmd.arg("--port")
        .arg(port.to_string())
        .env("SUHBATDOSH_DATA_DIR", &data_dir);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.spawn().ok()
}

pub fn run() {
    let app = tauri::Builder::default()
        .manage(BackendChild(Mutex::new(None)))
        .setup(|app| {
            let port = if cfg!(debug_assertions) && check_health(8123) {
                8123
            } else {
                pick_port()
            };

            if let Some(child) = spawn_backend(app.handle(), port) {
                if let Ok(mut guard) = app.state::<BackendChild>().0.lock() {
                    *guard = Some(child);
                }
            }

            // Build system tray menu
            let show_item = MenuItem::with_id(app, "show", "Show Suhbatdosh", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            if let Some(icon) = app.default_window_icon().cloned() {
                TrayIconBuilder::new()
                    .icon(icon)
                    .menu(&menu)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                        "quit" => {
                            app.state::<BackendChild>().stop();
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .build(app)?;
            }

            // In release mode, wait for the local FastAPI backend and navigate to it
            // so httpOnly cookies, CSRF, AudioWorklet, and WS /ws/ico share one origin.
            if !cfg!(debug_assertions) {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    if wait_for_backend(port, Duration::from_secs(20)) {
                        if let Some(win) = handle.get_webview_window("main") {
                            let url = format!("http://127.0.0.1:{port}");
                            if let Ok(parsed) = url.parse() {
                                let _ = win.navigate(parsed);
                            }
                        }
                    }
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Suhbatdosh desktop application");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            app_handle.state::<BackendChild>().stop();
        }
    });
}
