use tauri::{Emitter, Manager};
use serde::Serialize;

/// Latest release info returned to the frontend by check_update.
#[derive(Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub notes: String,
    pub page_url: String,
    pub download_url: String,
}

/// App data folder name under %APPDATA% (deliberately without "!" - file
/// system naming convention), unlike the product display name.
const DATA_DIR_NAME: &str = "votekickViewer3D";

/// Ensures the data layout exists on first launch:
/// %APPDATA%\votekickViewer3D\cfg, ...\cache and ...\lang.
fn ensure_data_dirs(app: &tauri::App) {
    if let Ok(roaming) = app.path().data_dir() {
        let base = roaming.join(DATA_DIR_NAME);
        let _ = std::fs::create_dir_all(base.join("cfg"));
        let _ = std::fs::create_dir_all(base.join("cache"));
        let _ = std::fs::create_dir_all(base.join("lang"));
        // Clean up installers downloaded by a previous auto-update: each
        // fresh launch starts with an empty update folder.
        let update_dir = base.join("cache").join("update");
        if let Ok(entries) = std::fs::read_dir(&update_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    let _ = std::fs::remove_file(path);
                }
            }
        }
    }
}

/// Path of the settings file:
/// %APPDATA%\votekickViewer3D\cfg\settings.json
fn settings_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .data_dir()
        .ok()
        .map(|roaming| roaming.join(DATA_DIR_NAME).join("cfg").join("settings.json"))
}

/// The whole settings file as a JSON string; `None` when it does not exist
/// yet (first launch) - the frontend then uses its built-in defaults.
#[tauri::command]
fn load_settings(app: tauri::AppHandle) -> Option<String> {
    std::fs::read_to_string(settings_path(&app)?).ok()
}

/// Stores the settings file sent by the frontend. The frontend owns the
/// schema; the backend only guarantees the location and safe writes
/// (temp file + rename, so a crash mid-write cannot truncate the file).
#[tauri::command]
fn save_settings(app: tauri::AppHandle, json: String) {
    let Some(path) = settings_path(&app) else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let tmp = path.with_extension("json.tmp");
    if std::fs::write(&tmp, json).is_ok() {
        let _ = std::fs::rename(&tmp, &path);
    }
}

/// Folder with the user-provided language files:
/// %APPDATA%\votekickViewer3D\lang
fn lang_dir(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .data_dir()
        .ok()
        .map(|roaming| roaming.join(DATA_DIR_NAME).join("lang"))
}

/// Names (file stems) of the user-provided language files in the lang
/// folder; the built-in "english" is not listed - the frontend adds it.
#[tauri::command]
fn list_languages(app: tauri::AppHandle) -> Vec<String> {
    let mut names = Vec::new();
    if let Some(dir) = lang_dir(&app) {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let is_json = path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("json"));
                if is_json {
                    if let Some(stem) = path.file_stem().and_then(|stem| stem.to_str()) {
                        names.push(stem.to_string());
                    }
                }
            }
        }
    }
    names.sort();
    names
}

/// Contents of one user language file; `None` for the built-in "english"
/// (the frontend keeps its built-in dictionary) or a bad name.
#[tauri::command]
fn load_language(app: tauri::AppHandle, name: String) -> Option<String> {
    if name == "english" || name.contains(['\\', '/', ':', '.']) {
        return None;
    }
    let dir = lang_dir(&app)?;
    std::fs::read_to_string(dir.join(format!("{name}.json"))).ok()
}

/// Writes the built-in English dictionary (sent by the frontend) as the
/// template %APPDATA%\votekickViewer3D\lang\english.json, so users can copy
/// it, translate it and rename the copy. An existing file is not touched.
#[tauri::command]
fn save_language_template(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let dir = lang_dir(&app).ok_or_else(|| "no data directory".to_string())?;
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let path = dir.join("english.json");
    if !path.exists() {
        std::fs::write(&path, json).map_err(|err| err.to_string())?;
    }
    Ok(())
}

/// Applies the saved window state on startup, while the window is still
/// hidden (tauri.conf.json sets `visible: false`), then shows it - so the
/// window never visibly resizes or jumps.
///
/// - `window.launchMaximized`: start maximized
/// - `window.alwaysOnTop`: keep the window above all others
/// - otherwise: the fixed 640x480 window from the config, centered on the
///   screen (the size is deliberately not persisted)
fn apply_startup_window_state(app: &tauri::App) {
    let Some(window) = app.get_webview_window("main") else { return };

    let setting = |key: &str| {
        settings_path(app.handle())
            .and_then(|path| std::fs::read_to_string(path).ok())
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
            .and_then(|value| value["window"][key].as_bool())
            .unwrap_or(false)
    };

    if setting("launchMaximized") {
        let _ = window.maximize();
    } else {
        let _ = window.center();
    }

    if setting("alwaysOnTop") {
        let _ = window.set_always_on_top(true);
    }

    // Opt-in: keep the fullscreen state across launches. Applied after the
    // maximize choice, so fullscreen wins when both are enabled.
    if setting("rememberFullscreen") && setting("fullscreen") {
        let _ = window.set_fullscreen(true);
    }

    let _ = window.show();
    let _ = window.set_focus();
}

/// Supported model file extensions, lowercase with the leading dot.
const MODEL_EXTENSIONS: [&str; 8] =
    [".glb", ".gltf", ".fbx", ".obj", ".stl", ".ply", ".dae", ".3ds"];

/// Returns the first command line argument that looks like a model file path.
/// argv[0] is the executable itself; flags are ignored, and anything that is
/// not a model path (e.g. stray tooling arguments) is ignored too.
fn model_file_from_args(args: &[String]) -> Option<String> {
    args.iter()
        .skip(1)
        .find(|a| {
            let lower = a.to_lowercase();
            MODEL_EXTENSIONS.iter().any(|ext| lower.ends_with(ext))
        })
        .cloned()
}

/// The frontend asks for this once on startup, so a path given on the very
/// first launch is not lost to a startup race.
#[tauri::command]
fn initial_file() -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    model_file_from_args(&args)
}

/// Downloads the installer to the app cache folder and launches it; the
/// frontend then quits the app so the installer can replace the exe.
#[tauri::command]
async fn download_installer(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent("votekickViewer3D")
        .build()
        .map_err(|e| e.to_string())?;
    let bytes = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    let cache = app
        .path()
        .cache_dir()
        .map_err(|e| e.to_string())?
        .join(DATA_DIR_NAME)
        .join("update");
    std::fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
    let path = cache.join("votekickViewer3D-setup.exe");
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    std::process::Command::new(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Compares dot-separated numeric versions ("0.0.4" vs tag "v0.0.5").
fn version_is_newer(latest: &str, current: &str) -> bool {
    let nums = |s: &str| -> Vec<u64> {
        s.trim().trim_start_matches('v')
            .split('.')
            .map(|n| n.parse().unwrap_or(0))
            .collect()
    };
    let a = nums(latest);
    let b = nums(current);
    for i in 0..a.len().max(b.len()) {
        let x = *a.get(i).unwrap_or(&0);
        let y = *b.get(i).unwrap_or(&0);
        if x != y { return x > y; }
    }
    false
}

/// Queries the latest GitHub release. Returns None when the current
/// version is up to date; errors are reported to the frontend as strings.
#[tauri::command]
async fn check_update(current: String) -> Result<Option<UpdateInfo>, String> {
    let client = reqwest::Client::builder()
        .user_agent("votekickViewer3D")
        .build()
        .map_err(|e| e.to_string())?;
    let data: serde_json::Value = client
        .get("https://api.github.com/repos/votekickAlex/votekickViewer3D/releases/latest")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let tag = data["tag_name"].as_str().unwrap_or("").to_string();
    if !version_is_newer(&tag, &current) {
        return Ok(None);
    }
    let version = tag.trim_start_matches('v').to_string();
    let notes = data["body"].as_str().unwrap_or("").to_string();
    let page_url = data["html_url"].as_str().unwrap_or("").to_string();
    // The NSIS installer is the only -setup.exe asset in a release.
    let download_url = data["assets"]
        .as_array()
        .and_then(|assets| {
            assets.iter().find_map(|a| {
                let name = a["name"].as_str().unwrap_or("");
                if name.ends_with("-setup.exe") {
                    a["browser_download_url"].as_str().map(|s| s.to_string())
                } else {
                    None
                }
            })
        })
        .unwrap_or_default();
    Ok(Some(UpdateInfo { version, notes, page_url, download_url }))
}

/// Model files (by extension) in one folder, absolute paths sorted by
/// file name; backs the Arrow Left / Right "previous / next model in the
/// folder" navigation.
#[tauri::command]
fn list_models(dir: String) -> Vec<String> {
    let mut paths = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            let lower = name.to_lowercase();
            if MODEL_EXTENSIONS.iter().any(|ext| lower.ends_with(ext)) {
                paths.push(path.to_string_lossy().into_owned());
            }
        }
    }
    paths.sort_by_key(|path| {
        path.rsplit(['\\', '/'])
            .next()
            .unwrap_or(path)
            .to_lowercase()
    });
    paths
}

/// Appends one timestamped ERROR line to a log file. Primary location is
/// `log.txt` next to the executable; when that is not writable (Program
/// Files without elevation) the fallback is
/// %APPDATA%\votekickViewer3D\log.txt. Newlines inside the message are
/// collapsed so the file stays line-oriented.
#[tauri::command]
fn log_error(app: tauri::AppHandle, message: String) {
    let line = format!(
        "[{}] ERROR  {}",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
        message.replace(['\r', '\n'], " "),
    );

    fn append_line(path: &std::path::Path, line: &str) -> bool {
        use std::io::Write;
        match std::fs::OpenOptions::new().create(true).append(true).open(path) {
            Ok(mut file) => file.write_all(line.as_bytes()).is_ok() && file.write_all(b"\n").is_ok(),
            Err(_) => false,
        }
    }

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(std::path::Path::to_path_buf));
    if let Some(dir) = exe_dir {
        if append_line(&dir.join("log.txt"), &line) {
            return;
        }
    }
    if let Ok(roaming) = app.path().data_dir() {
        let _ = append_line(&roaming.join(DATA_DIR_NAME).join("log.txt"), &line);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single instance: when Explorer opens another model while the viewer
        // is already running, route it to the existing window instead of
        // spawning a second app.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(path) = model_file_from_args(&argv) {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("open-file", path);
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            initial_file,
            list_models,
            check_update,
            download_installer,
            load_settings,
            save_settings,
            log_error,
            list_languages,
            load_language,
            save_language_template
        ])
        .setup(|app| {
            ensure_data_dirs(app);
            apply_startup_window_state(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
