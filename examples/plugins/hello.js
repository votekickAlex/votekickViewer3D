// Example plugin for !votekickViewer3D.
// Copy this file to %APPDATA%\votekickViewer3D\plugins\ and enable it
// in Tools > Plugins. The app exposes the API as window.vk.

vk.onModelLoaded(function (info) {
  vk.showMessage("Plugin: loaded " + info.name + " (" + info.triangles + " triangles)");
});

vk.registerButton("Wireframe", function () {
  vk.setWireframe(true);
});

vk.registerButton("Reset view", function () {
  vk.resetView();
});
