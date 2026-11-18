// Public plugin API exposed as window.vk. Plugins are user-provided
// scripts from %APPDATA%\votekickViewer3D\plugins\, loaded at startup.
// The API is intentionally small: a plugin can react to events, drive
// the main View toggles, write to the status bar and inspect the model.

import type * as THREE from "three";

export interface ModelInfo {
  name: string;
  width: number;
  height: number;
  depth: number;
  triangles: number;
  clips: string[];
}

type ModelCb = (info: ModelInfo) => void;
type SimpleCb = () => void;

export interface PluginApi {
  onModelLoaded(cb: ModelCb): void;
  onViewChanged(cb: SimpleCb): void;
  onAnimationChanged(cb: SimpleCb): void;
  getModelInfo(): ModelInfo | null;
  getModel(): THREE.Object3D | null;
  setGrid(on: boolean): void;
  setWireframe(on: boolean): void;
  setBoundingBox(on: boolean): void;
  setAxes(on: boolean): void;
  setViewPreset(name: "front" | "back" | "left" | "right" | "top" | "bottom"): void;
  resetView(): void;
  showMessage(text: string): void;
  registerButton(label: string, cb: SimpleCb): void;
}

/** Creates the vk API object bound to the current app state. */
export function createPluginApi(host: {
  getModelInfo: () => ModelInfo | null;
  getModel: () => THREE.Object3D | null;
  setGrid: (on: boolean) => void;
  setWireframe: (on: boolean) => void;
  setBoundingBox: (on: boolean) => void;
  setAxes: (on: boolean) => void;
  setViewPreset: (name: "front" | "back" | "left" | "right" | "top" | "bottom") => void;
  resetView: () => void;
  showMessage: (text: string) => void;
  registerButton: (label: string, cb: SimpleCb) => void;
}): PluginApi {
  const modelCbs: ModelCb[] = [];
  const viewCbs: SimpleCb[] = [];
  const animCbs: SimpleCb[] = [];
  const api: PluginApi = {
    onModelLoaded: (cb) => { modelCbs.push(cb); },
    onViewChanged: (cb) => { viewCbs.push(cb); },
    onAnimationChanged: (cb) => { animCbs.push(cb); },
    getModelInfo: () => host.getModelInfo(),
    getModel: () => host.getModel(),
    setGrid: (on) => host.setGrid(on),
    setWireframe: (on) => host.setWireframe(on),
    setBoundingBox: (on) => host.setBoundingBox(on),
    setAxes: (on) => host.setAxes(on),
    setViewPreset: (name) => host.setViewPreset(name),
    resetView: () => host.resetView(),
    showMessage: (text) => host.showMessage(text),
    registerButton: (label, cb) => host.registerButton(label, cb),
  };
  // Internal emitters used by main.ts (not part of the public surface).
  (api as any)._emitModel = (info: ModelInfo) => modelCbs.forEach((cb) => { try { cb(info); } catch (e) { console.warn("plugin onModelLoaded", e); } });
  (api as any)._emitView = () => viewCbs.forEach((cb) => { try { cb(); } catch (e) { console.warn("plugin onViewChanged", e); } });
  (api as any)._emitAnim = () => animCbs.forEach((cb) => { try { cb(); } catch (e) { console.warn("plugin onAnimationChanged", e); } });
  return api;
}
