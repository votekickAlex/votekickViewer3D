use tauri::{Emitter, Manager};

/// Returns the first command line argument that looks like a model file path.
/// argv[0] is the executable itself; everything starting with '-' is a flag.
fn model_file_from_args(args: &[String]) -> Option<String> {
    args.iter()
        .skip(1)
        .find(|a| !a.is_empty() && !a.starts_with('-'))
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
