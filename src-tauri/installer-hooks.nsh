;; Custom NSIS installer/uninstaller hooks.
;; Docs: https://tauri.app/distribute/windows-installer/#customizing-the-nsis-template

;; Runs at the very end of uninstallation, AFTER the template's built-in
;; "delete app data" logic (which honors $DeleteAppDataCheckboxState for its
;; own identifier-based folders and is now a no-op for us: the WebView2
;; profile lives in our own folder tree, see tauri.conf.json
;; app > appDirectoriesOverride).
;;
;; Our layout:
;;   %APPDATA%\votekickViewer3D\cfg           (settings)
;;   %APPDATA%\votekickViewer3D\cache\webview (WebView2 profile + cache)
;;
;; The uninstaller checkbox decides whether ALL app data is removed
;; (mirrors the template's own condition, including skipping update mode):
;;   checked   -> settings and cache are deleted
;;   unchecked -> settings and cache are kept for a future reinstall
;;
;; The legacy identifier folder (com.votekick.viewer3d) is a leftover from
;; earlier builds and is never user data, so it is always removed.
!macro NSIS_HOOK_POSTUNINSTALL
  SetShellVarContext current
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    RmDir /r "$APPDATA\votekickViewer3D"
    RmDir /r "$LOCALAPPDATA\votekickViewer3D"
  ${EndIf}
  RmDir /r "$LOCALAPPDATA\com.votekick.viewer3d"
!macroend
