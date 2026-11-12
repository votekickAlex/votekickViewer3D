;; Custom NSIS installer/uninstaller hooks.
;; Docs: https://tauri.app/distribute/windows-installer/#customizing-the-nsis-template

;; Runs at the very end of installation. Ask the shell to refresh file
;; associations and icons so Explorer picks them up immediately.
!macro NSIS_HOOK_POSTINSTALL
  !insertmacro UPDATEFILEASSOC
!macroend

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
;;
;; Registry notes:
;; - APP_UNASSOCIATE (FileAssociation.nsh) already removed our ProgIDs and
;;   restored the extensions' previous defaults; what remains are the
;;   `*_backup` values the template uses for the restore, and stale
;;   publisher keys from earlier builds. Both are removed here with explicit
;;   HKLM: associations and publisher keys are per-machine, while the shell
;;   context has already been switched to "current" for the user-profile
;;   cleanup above this point.
;; - UPDATEFILEASSOC sends SHChangeNotify(SHCNE_ASSOCCHANGED) so Explorer
;;   immediately reloads associations and stops showing our icons on the
;;   model files.
!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue HKLM "Software\Classes\.glb" "glTF Binary Model_backup"
  DeleteRegValue HKLM "Software\Classes\.gltf" "glTF Model_backup"
  DeleteRegValue HKLM "Software\Classes\.fbx" "Autodesk FBX Model_backup"
  DeleteRegValue HKLM "Software\Classes\.obj" "Wavefront OBJ Model_backup"
  DeleteRegValue HKLM "Software\Classes\.stl" "Stereolithography Model_backup"
  DeleteRegValue HKLM "Software\Classes\.ply" "Polygon File Format Model_backup"
  DeleteRegValue HKLM "Software\Classes\.dae" "COLLADA Model_backup"
  DeleteRegValue HKLM "Software\Classes\.3ds" "Autodesk 3ds Model_backup"

  ; Publisher registry key from builds before the "!votekickAlex" publisher.
  DeleteRegKey /ifempty HKLM "Software\votekick"

  !insertmacro UPDATEFILEASSOC

  SetShellVarContext current
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    RmDir /r "$APPDATA\votekickViewer3D"
    RmDir /r "$LOCALAPPDATA\votekickViewer3D"
  ${EndIf}
  RmDir /r "$LOCALAPPDATA\com.votekick.viewer3d"
!macroend
