;; Custom NSIS installer/uninstaller hooks.
;; Docs: https://tauri.app/distribute/windows-installer/#customizing-the-installer

;; Runs at the very end of uninstallation. The template has already shown its
;; "delete application data" checkbox and stored the result in
;; $DeleteAppDataCheckboxState. Config and logs normally live next to the exe
;; (removed together with the install dir); this hook removes the AppData part
;; (cache + fallback cfg/logs) when the user opted in.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
    SetShellVarContext current
    RmDir /r "$APPDATA\votekickViewer3D"
  ${EndIf}
!macroend
