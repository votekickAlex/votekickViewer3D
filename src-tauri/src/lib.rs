use tauri::{Emitter, Manager};

/// App data folder name under %APPDATA% (deliberately without "!" — file
/// system naming convention), unlike the product display name.
const DATA_DIR_NAME: &str = "votekickViewer3D";

/// Ensures the data layout exists on first launch:
/// %APPDATA%\votekickViewer3D\cfg and ...\cache.
fn ensure_data_dirs(app: &tauri::App) {
    if let Ok(roaming) = app.path().data_dir() {
        let base = roaming.join(DATA_DIR_NAME);
        let _ = std::fs::create_dir_all(base.join("cfg"));
        let _ = std::fs::create_dir_all(base.join("cache"));
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
/// yet (first launch) — the frontend then uses its built-in defaults.
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

/// Restores the saved window size on startup, before the first frame the
/// user sees, so the window opens at the remembered size instead of
/// resizing visibly afterwards.
fn apply_saved_window_size(app: &tauri::App) {
    let Some(path) = settings_path(app.handle()) else { return };
    let Ok(text) = std::fs::read_to_string(path) else { return };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else { return };
    let width = value["window"]["width"].as_f64();
    let height = value["window"]["height"].as_f64();
    let (Some(width), Some(height)) = (width, height) else { return };
    // Ignore implausible values (corrupted file, tiny window unusable).
    if width < 320.0 || height < 240.0 || width > 16_384.0 || height > 16_384.0 {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_size(tauri::LogicalSize::new(width, height));
    }
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
        .invoke_handler(tauri::generate_handler![initial_file, load_settings, save_settings])
        .setup(|app| {
            ensure_data_dirs(app);
            apply_saved_window_size(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
