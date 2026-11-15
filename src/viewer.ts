import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const BG_COLOR = 0x1c1f24;
/** Fallback grid color; the persisted setting overrides it at startup. */
const DEFAULT_GRID_COLOR = "#b03a3a";
const GRID_CENTER_COLOR = 0x565d68;
const DEFAULT_BBOX_COLOR = "#4f9cf9";
const DEFAULT_WIREFRAME_COLOR = "#ffffff";
const UP = new THREE.Vector3(0, 1, 0);

/** Parses "#rrggbb" or "#rrggbbaa"; the optional trailing pair becomes an
 * opacity factor for the line materials. */
function parseHexColor(hex: string): { color: THREE.Color; alpha: number } {
  const text = hex.replace("#", "").trim();
  const color = new THREE.Color(`#${text.slice(0, 6).padEnd(6, "0")}`);
  let alpha = 1;
  if (text.length >= 8) {
    alpha = parseInt(text.slice(6, 8), 16) / 255;
    if (Number.isNaN(alpha)) alpha = 1;
  }
  return { color, alpha };
}

// Axis colors follow Blender: its X red, Y green, Z blue map onto our
// Y-up scene as x red, y (up) blue, z green.
const AXIS_X_COLOR = 0xd95454;
const AXIS_Y_COLOR = 0x4a90d9;
const AXIS_Z_COLOR = 0x5aa02c;

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  private grid: THREE.Group;
  private modelRoot: THREE.Group;
  private wireframe = false;
  /** Shared material for the wireframe overlay: one flat, user-colored
   * look drawn on top of the intact solid model. */
  private wireframeMaterial: THREE.MeshBasicMaterial;
  /** Overlay meshes mirroring the model's meshes; they share geometry, so
   * they are cheap and never disposed here. */
  private wireOverlays: THREE.Mesh[] = [];
  private bbox: THREE.Box3;
  private bboxHelper: THREE.Box3Helper;
  private orthoCamera: THREE.OrthographicCamera;
  private orthoOn = false;
  /** Half height of the orthographic frustum (world units at zoom 1). */
  private orthoHalfH = 1;
  /** Cheap FPS counter: frames counted in the render loop, averaged over
   * half a second; the status bar reads `fps`. */
  private frames = 0;
  private lastFpsTime = performance.now();
  fps = 0;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BG_COLOR);

    // Soft image-based lighting so PBR materials look right with no setup.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 4000);
    this.camera.position.set(3, 2, 4);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;

    // Orthographic twin: the frustum is sized so a switch keeps the same
    // on-screen scale (see setOrthographic). controls.object is swapped
    // between the two cameras.
    const initialDist = this.camera.position.length();
    this.orthoHalfH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * initialDist;
    this.orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 4000);
    this.orthoCamera.position.copy(this.camera.position);
    this.updateOrthoFrustum();

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(5, 10, 7);
    this.scene.add(sun);

    this.grid = this.createGrid(DEFAULT_GRID_COLOR);
    this.scene.add(this.grid);

    this.modelRoot = new THREE.Group();
    this.scene.add(this.modelRoot);

    // The bounding box helper reads this Box3 on every frame, so the box
    // edges follow the model automatically once the Box3 is recomputed.
    this.bbox = new THREE.Box3();
    this.bboxHelper = new THREE.Box3Helper(this.bbox, DEFAULT_BBOX_COLOR);
    this.bboxHelper.visible = false;
    this.scene.add(this.bboxHelper);

    this.wireframeMaterial = new THREE.MeshBasicMaterial({
      color: DEFAULT_WIREFRAME_COLOR,
      wireframe: true,
      toneMapped: false,
    });
    this.applyHexAlpha(this.wireframeMaterial, DEFAULT_WIREFRAME_COLOR);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.activeCamera);
      this.frames++;
      const now = performance.now();
      if (now - this.lastFpsTime >= 500) {
        this.fps = Math.round((this.frames * 1000) / (now - this.lastFpsTime));
        this.frames = 0;
        this.lastFpsTime = now;
      }
    });
  }

  private createGrid(gridHex: string): THREE.Group {
    const group = new THREE.Group();
    const { color, alpha } = parseHexColor(gridHex);

    const grid = new THREE.GridHelper(20, 20, GRID_CENTER_COLOR, color.getHex());
    const mat = grid.material as THREE.LineBasicMaterial;
    // Fully opaque, depth test off and drawn last: the grid stays a solid
    // constant-color overlay on top of the model instead of hiding behind
    // it or bleeding through it.
    mat.depthTest = false;
    mat.toneMapped = false;
    if (alpha < 1) {
      mat.transparent = true;
      mat.opacity = alpha;
    }
    grid.renderOrder = 10;
    // Repaint the two center lines through the origin: X red, Z green
    // (Blender's ground plane axes). For GridHelper(20, 20) the line
    // block i occupies vertices 4i..4i+3: 4i/4i+1 are the line along X,
    // 4i+2/4i+3 the line along Z, so the center block starts at 4*10.
    const colors = grid.geometry.getAttribute("color") as THREE.BufferAttribute;
    const red = new THREE.Color(AXIS_X_COLOR);
    const green = new THREE.Color(AXIS_Z_COLOR);
    for (const v of [40, 41]) colors.setXYZ(v, red.r, red.g, red.b);
    for (const v of [42, 43]) colors.setXYZ(v, green.r, green.g, green.b);
    group.add(grid);

    // The vertical axis helper with Blender colors: our Y (up) is blue
    // and our Z is green, drawn as lines through the origin.
    const axisLine = (dir: THREE.Vector3, color: number): THREE.Line => {
      const geo = new THREE.BufferGeometry().setFromPoints([
        dir.clone().multiplyScalar(-1),
        dir.clone(),
      ]);
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({ color, toneMapped: false, depthTest: false }),
      );
      line.renderOrder = 10;
      return line;
    };
    group.add(axisLine(new THREE.Vector3(1, 0, 0), AXIS_X_COLOR));
    group.add(axisLine(new THREE.Vector3(0, 1, 0), AXIS_Y_COLOR));
    group.add(axisLine(new THREE.Vector3(0, 0, 1), AXIS_Z_COLOR));
    return group;
  }

  setModel(object: THREE.Object3D): void {
    this.disposeModel();
    this.modelRoot.add(object);
    this.applyWireframe();
    this.refreshBBox();
    this.frameModel(true);
  }

  clearModel(): void {
    this.disposeModel();
    this.refreshBBox();
  }

  frameModel(resetAngle = false): void {
    if (this.modelRoot.children.length === 0) return;

    const box = new THREE.Box3().setFromObject(this.modelRoot);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    if (!isFinite(maxDim) || maxDim === 0) return;

    // Fit the bounding sphere into view for both the vertical and the
    // (usually wider) horizontal field of view.
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const fovV = THREE.MathUtils.degToRad(this.camera.fov);
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * this.camera.aspect);
    const fov = Math.min(fovV, fovH);
    const distance = (sphere.radius / Math.sin(fov / 2)) * 1.15;

    // Reset view returns to the canonical angle; otherwise keep the
    // current camera direction and just move to the fitting distance.
    const dir = this.camera.position.clone().sub(this.controls.target);
    if (resetAngle || dir.lengthSq() < 1e-6) dir.set(3, 2, 4);

    this.controls.target.copy(center);
    const cam = this.activeCamera;
    cam.up.set(0, 1, 0);
    cam.position.copy(center).addScaledVector(dir.normalize(), distance);

    // Dynamic near/far so huge and tiny models both render correctly.
    this.camera.near = Math.max(maxDim / 1000, 0.001);
    this.camera.far = Math.max(distance * 100, 100);
    this.camera.updateProjectionMatrix();
    this.orthoCamera.near = this.camera.near;
    this.orthoCamera.far = this.camera.far;
    if (this.orthoOn) {
      this.orthoCamera.position.copy(cam.position);
      // The frustum is recomputed from scratch, so a zoom factor left by
      // wheel zoom must be dropped: OrbitControls zooms an orthographic
      // camera by scaling camera.zoom instead of moving it, and the old
      // factor would keep the model at its previous on-screen size.
      this.orthoCamera.zoom = 1;
      this.orthoHalfH = Math.tan(fov / 2) * distance;
      this.updateOrthoFrustum();
    }
    this.controls.update();
  }

  setGridVisible(visible: boolean): void {
    this.grid.visible = visible;
  }

  get gridVisible(): boolean {
    return this.grid.visible;
  }

  /** Rebuilds the grid with a new color (Settings > Colors); visibility
   * and the fixed Blender axis colors are preserved. */
  setGridColor(hex: string): void {
    const visible = this.grid.visible;
    this.scene.remove(this.grid);
    this.grid.traverse((obj) => {
      // The root Group itself has neither geometry nor material; skip it.
      const line = obj as THREE.Line;
      if (!line.geometry || !line.material) return;
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    });
    this.grid = this.createGrid(hex);
    this.grid.visible = visible;
    this.scene.add(this.grid);
  }

  /** Color of the flat wireframe overlay (Settings > Colors). */
  setWireframeColor(hex: string): void {
    this.wireframeMaterial.color = parseHexColor(hex).color;
    this.applyHexAlpha(this.wireframeMaterial, hex);
  }

  /** Color of the bounding box edges (Settings > Colors). */
  setBBoxColor(hex: string): void {
    const material = this.bboxHelper.material as THREE.LineBasicMaterial;
    material.color = parseHexColor(hex).color;
    this.applyHexAlpha(material, hex);
  }

  /** Applies the optional "#rrggbbaa" alpha pair as material opacity;
   * fully opaque values render hard (no transparency pass). */
  private applyHexAlpha(material: THREE.Material, hex: string): void {
    const alpha = parseHexColor(hex).alpha;
    if (alpha < 1) {
      material.transparent = true;
      material.opacity = alpha;
    } else {
      material.transparent = false;
      material.opacity = 1;
    }
    material.needsUpdate = true;
  }

  // ---------- Blender-style views ----------

  get activeCamera(): THREE.Camera {
    return this.orthoOn ? this.orthoCamera : this.camera;
  }

  get orthographic(): boolean {
    return this.orthoOn;
  }

  /** Toggles between the perspective and the orthographic camera, keeping
   * the on-screen scale and the camera position/target. */
  setOrthographic(on: boolean): void {
    if (on === this.orthoOn) return;
    const from = this.activeCamera;
    const dir = from.position.clone().sub(this.controls.target);
    if (on) {
      // Entering ortho: frustum matches the current perspective view.
      const dist = Math.max(dir.length(), 1e-6);
      this.orthoHalfH =
        Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * dist;
      this.orthoCamera.zoom = 1;
      this.orthoCamera.position.copy(from.position);
      this.updateOrthoFrustum();
    } else {
      // Leaving ortho: place the perspective camera so the view keeps its
      // size (frustum half height / tan(fov/2) = matching distance).
      const dist =
        this.orthoHalfH / this.orthoCamera.zoom /
        Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
      dir.setLength(dist);
      this.camera.position.copy(this.controls.target).add(dir);
    }
    this.camera.up.copy(from.up);
    this.orthoCamera.up.copy(from.up);
    this.orthoOn = on;
    this.controls.object = this.activeCamera;
    this.controls.update();
  }

  private updateOrthoFrustum(): void {
    const halfW = this.orthoHalfH * this.camera.aspect;
    this.orthoCamera.left = -halfW;
    this.orthoCamera.right = halfW;
    this.orthoCamera.top = this.orthoHalfH;
    this.orthoCamera.bottom = -this.orthoHalfH;
    this.orthoCamera.updateProjectionMatrix();
  }

  /** Canonical axis views. Front/Back look along Z, Left/Right along X,
   * Top/Bottom along Y; up is +Y except on Top/Bottom where +Z keeps the
   * view direction and the up vector from being parallel. */
  setViewPreset(preset: "front" | "back" | "left" | "right" | "top" | "bottom"): void {
    const dirs: Record<typeof preset, [number, number, number]> = {
      front: [0, 0, 1],
      back: [0, 0, -1],
      right: [1, 0, 0],
      left: [-1, 0, 0],
      top: [0, 1, 0],
      bottom: [0, -1, 0],
    };
    const cam = this.activeCamera;
    const dir = cam.position.clone().sub(this.controls.target);
    const dist = dir.length() > 1e-6 ? dir.length() : 5;
    cam.up.set(0, 1, 0);
    if (preset === "top" || preset === "bottom") cam.up.set(0, 0, -1);
    cam.position
      .copy(this.controls.target)
      .addScaledVector(new THREE.Vector3(...dirs[preset]), dist);
    this.controls.update();
  }

  /** Orbits the camera around the target: yaw around world up, pitch
   * around the view's horizontal (right) axis. Used by numpad 2/4/6/8. */
  orbitView(yawDeg: number, pitchDeg: number): void {
    const cam = this.activeCamera;
    const dir = cam.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-12) return;
    if (yawDeg !== 0) dir.applyAxisAngle(UP, THREE.MathUtils.degToRad(yawDeg));
    if (pitchDeg !== 0) {
      const right = new THREE.Vector3().crossVectors(dir, cam.up).normalize();
      if (right.lengthSq() > 1e-12) {
        dir.applyAxisAngle(right, THREE.MathUtils.degToRad(pitchDeg));
      }
    }
    cam.position.copy(this.controls.target).add(dir);
    this.controls.update();
  }

  /** Zooms in (factor < 1) or out (factor > 1): the perspective camera
   * dollies, the orthographic camera shrinks/grows its frustum. */
  zoomView(factor: number): void {
    if (this.orthoOn) {
      this.orthoHalfH *= factor;
      this.updateOrthoFrustum();
      return;
    }
    const dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-12) return;
    dir.multiplyScalar(factor);
    this.camera.position.copy(this.controls.target).add(dir);
    this.controls.update();
  }

  /** Numpad 9: jumps to the opposite side of the current view. */
  flipView(): void {
    const cam = this.activeCamera;
    const dir = cam.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-12) return;
    cam.position.copy(this.controls.target).sub(dir);
    this.controls.update();
  }

  get hasModel(): boolean {
    return this.modelRoot.children.length > 0;
  }

  setWireframe(on: boolean): void {
    this.wireframe = on;
    this.applyWireframe();
  }

  get wireframeOn(): boolean {
    return this.wireframe;
  }

  setBBoxVisible(visible: boolean): void {
    this.bboxHelper.visible = visible;
    if (visible) this.refreshBBox();
  }

  get bboxVisible(): boolean {
    return this.bboxHelper.visible;
  }

  /** Recomputes the Box3 the helper renders; called when a model loads or
   * the box is toggled on. */
  private refreshBBox(): void {
    if (this.modelRoot.children.length === 0) {
      this.bbox.makeEmpty();
      return;
    }
    this.bbox.setFromObject(this.modelRoot);
  }

  private applyWireframe(): void {
    if (this.wireframe) {
      // Add an overlay mesh as a child of every model mesh: it inherits
      // the transform, shares the geometry (no copies) and draws its
      // triangle edges on top of the intact solid surface. The flag keeps
      // the traversal from recursing into the overlays themselves.
      const overlays: THREE.Mesh[] = [];
      this.modelRoot.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh || (mesh.userData as { wireOverlay?: boolean }).wireOverlay) return;
        const overlay = new THREE.Mesh(mesh.geometry, this.wireframeMaterial);
        overlay.userData.wireOverlay = true;
        overlay.renderOrder = 5;
        mesh.add(overlay);
        overlays.push(overlay);
      });
      this.wireOverlays = overlays;
    } else {
      for (const overlay of this.wireOverlays) overlay.removeFromParent();
      this.wireOverlays = [];
    }
  }

  private disposeModel(): void {
    // Overlays share their geometry with the model meshes; dropping them
    // first keeps the shared wireframe material alive and avoids double
    // disposal.
    for (const overlay of this.wireOverlays) overlay.removeFromParent();
    this.wireOverlays = [];
    this.modelRoot.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Overlays are visited too: their geometry belongs to the parent
      // mesh and their material is shared, never dispose either.
      if ((mesh.userData as { wireOverlay?: boolean }).wireOverlay) return;
      mesh.geometry?.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of materials) {
        if (!m) continue;
        for (const value of Object.values(m)) {
          if (value instanceof THREE.Texture) value.dispose();
        }
        m.dispose();
      }
    });
    this.modelRoot.clear();
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.updateOrthoFrustum();
    this.renderer.setSize(w, h);
  }
}
