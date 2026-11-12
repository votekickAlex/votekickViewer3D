;; Custom NSIS installer/uninstaller hooks.
;; Docs: https://tauri.app/distribute/windows-installer/#customizing-the-installer

;; Runs at the very end of uninstallation. The template has already shown its
;; "delete application data" checkbox and stored the result in
;; $DeleteAppDataCheckboxState. Config (cfg/) and cache always live in
;; %APPDATA%\votekickViewer3D; the log usually lives next to the exe (removed
;; together with the install dir) and falls back to %APPDATA%\votekickViewer3D
;; on write failure. This hook removes that AppData folder when opted in.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
    SetShellVarContext current
    RmDir /r "$APPDATA\votekickViewer3D"
  ${EndIf}
!macroend
