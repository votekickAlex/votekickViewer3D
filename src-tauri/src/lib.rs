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
        .invoke_handler(tauri::generate_handler![initial_file])
        .setup(|app| {
            ensure_data_dirs(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
