;; Custom NSIS installer/uninstaller hooks.
;; Docs: https://tauri.app/distribute/windows-installer/#customizing-the-installer

;; Runs at the very end of uninstallation. Our data (cfg + cache + fallback
;; log) always lives in %APPDATA%\votekickViewer3D and is ALWAYS removed on
;; uninstall. The template's built-in "delete app data" checkbox is ignored:
;; its own logic only touches identifier-based folders that we never use.
!macro NSIS_HOOK_POSTUNINSTALL
  SetShellVarContext current
  RmDir /r "$APPDATA\votekickViewer3D"
!macroend
