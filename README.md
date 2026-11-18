# !votekickViewer3D

A lightweight 3D model viewer for Windows. Double-click a model file in
Explorer and it opens instantly in a minimal viewer - the photo-viewer
experience, for 3D models. Free and open source (MIT).

<!-- Screenshot placeholder: drop a screenshot to docs/screenshot.png and
uncomment below.
![!votekickViewer3D](docs/screenshot.png)
-->

## Supported formats

| Format | Extension | Notes |
|---|---|---|
| glTF Binary | `.glb` | |
| glTF | `.gltf` | |
| Autodesk FBX | `.fbx` | textures are picked up from the model's folder |
| Wavefront OBJ | `.obj` | uses the sidecar `.mtl` and texture files |
| Stereolithography | `.stl` | ASCII and binary |
| Polygon File Format | `.ply` | ASCII and binary, vertex colors |
| COLLADA | `.dae` | |
| Autodesk 3DS | `.3ds` | |

## Install

1. Go to [Releases](https://github.com/votekickAlex/votekickViewer3D/releases)
2. Download `votekickViewer3D_<version>_x64-setup.exe` and run it
   - installs to `C:\Program Files\votekickViewer3D`
   - registers all formats above as default viewer
   - desktop / Start Menu shortcut: **!votekickViewer3D**

Or grab `votekickViewer3D_<version>-portable.zip` for a no-install,
standalone `votekickViewer3D.exe`.

Uninstalling is a standard Windows "Uninstall" - and the uninstaller's
"delete app data" checkbox decides whether your settings are removed too.

## Data locations

- Program: `C:\Program Files\votekickViewer3D`
- Settings: `%APPDATA%\votekickViewer3D\cfg`
- Cache: `%APPDATA%\votekickViewer3D\cache`
- Translations: `%APPDATA%\votekickViewer3D\lang`
- Load error log: `log.txt` next to the executable (AppData fallback when
  that is not writable)

## Controls

Mouse: orbit / pan / zoom like any 3D viewer; a freshly opened model is
auto-framed to fit the window. You can also drop a file onto the window.

The full list is always available in the app: `F1` or File > Help.

### Keyboard

| Key | Action |
|---|---|
| `O` | Open file |
| `G` | Grid on/off |
| `W` | Wireframe on/off |
| `B` | Bounding box on/off |
| `R` | Reset view: fits the model to the window, keeps the current angle |
| `F` | Fullscreen |
| `H` | Toggle interface (hides everything but the 3D viewport) |
| `Q` | Quit |
| `M` | Cycle display units (Auto / m / cm / mm) |
| `Space` | Play / pause animation |
| `A` | World axes on / off |
| `Page Up` / `Page Down` | Previous / next animation clip |
| `F1` | Help (all hotkeys) |
| `Left` / `Right` | Previous / next model in the current model's folder |

Every binding is editable in Tools > Settings > Hotkeys, including mouse
buttons (e.g. `Ctrl+Mouse Left`); `Esc` cancels the capture, `Backspace`
clears it. The arrow navigation needs a model opened through Explorer or
the command line (dropped and picked files carry no folder path).

### Numpad views (Blender style)

Physical numpad keys, they work without NumLock. Axis views fit the model
the same way reset view does.

| Key | Action |
|---|---|
| `Num 1` / `Ctrl+Num 1` | Front / Back |
| `Num 3` / `Ctrl+Num 3` | Right / Left |
| `Num 7` / `Ctrl+Num 7` | Top / Bottom |
| `Num 9` | Jump to the opposite side |
| `Num 5` | Perspective / Orthographic toggle (keeps the on-screen scale) |
| `Num 2` / `Num 4` / `Num 6` / `Num 8` | Orbit in 5 degree steps |
| `Num +` / `Num -` | Zoom |

The same commands are in the View menu.

Animated models (GLB/glTF, FBX, DAE) play their first clip automatically
on open. `Space` pauses or resumes it; `Page Up` / `Page Down` switch
clips (also in the View menu, and the clip name in the status bar is
clickable). The status bar icons and readouts are clickable too, and
`A` toggles the world axes (also in View and Settings). Default colors:
grid `#404040`, wireframe `#00FFFF`, bounding box `#0080FF`.

The status bar shows the model size with units (e.g. 2 x 2 x 2 m, each
dimension number colored like its axis) on the left next to the file
stats, and the grid step (Step: 20 cm) plus the active unit mode on the
right, together with an XYZ axis legend in the axis colors; the axis the
camera looks straight along is styled like the disabled status icons.
The unit is picked automatically by scale, shown as plain numbers (a
world unit is assumed to be a meter, the glTF standard) or fixed with a
unit label in Settings > General > Display units (hotkey `M` cycles the
modes).

### Menu bar, settings and languages

- **File**: Open, Help, Quit.
- **View**: Reset view, Orthographic, the six axis views, Grid, Wireframe,
  Bounding box, Fullscreen, Interface; toggles show their state with a
  checkmark.
- **Tools**: Settings, Plugins (a stub for a future plugin system).
- **Settings** has three categories: General (launch maximized, always on
  top, language, display units), Colors (grid, wireframe, bounding box,
  axes opacity) and Hotkeys.
- **Languages**: plain JSON files. On first launch
  `english.json` is created in `%APPDATA%\votekickViewer3D\lang`; copy it,
  translate, rename to your language, put it back and it appears in the
  language list. Missing keys fall back to English.

## Building from source

Requires Node.js and Rust (see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)):

```sh
npm ci
npm run release   # builds installer + portable zip into release/
```

## License

[MIT](LICENSE)
