import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const BG_COLOR = 0x1c1f24;
const GRID_COLOR = 0x3a3f47;
const GRID_CENTER_COLOR = 0x565d68;
const BBOX_COLOR = 0x4f9cf9;
const UP = new THREE.Vector3(0, 1, 0);

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  private grid: THREE.Group;
  private modelRoot: THREE.Group;
  private wireframe = false;
  private bbox: THREE.Box3;
  private bboxHelper: THREE.Box3Helper;
  private orthoCamera: THREE.OrthographicCamera;
  private orthoOn = false;
  /** Half height of the orthographic frustum (world units at zoom 1). */
  private orthoHalfH = 1;

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

    this.grid = this.createGrid();
    this.scene.add(this.grid);

    this.modelRoot = new THREE.Group();
    this.scene.add(this.modelRoot);

    // The bounding box helper reads this Box3 on every frame, so the box
    // edges follow the model automatically once the Box3 is recomputed.
    this.bbox = new THREE.Box3();
    this.bboxHelper = new THREE.Box3Helper(this.bbox, BBOX_COLOR);
    this.bboxHelper.visible = false;
    this.scene.add(this.bboxHelper);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.activeCamera);
    });
  }

  private createGrid(): THREE.Group {
    const group = new THREE.Group();
    const grid = new THREE.GridHelper(20, 20, GRID_CENTER_COLOR, GRID_COLOR);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.6;
    group.add(grid);
    group.add(new THREE.AxesHelper(1));
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
    this.modelRoot.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of materials) {
        if ("wireframe" in m) (m as THREE.MeshBasicMaterial).wireframe = this.wireframe;
      }
    });
  }

  private disposeModel(): void {
    this.modelRoot.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of materials) {
          if (!m) continue;
          for (const value of Object.values(m)) {
            if (value instanceof THREE.Texture) value.dispose();
          }
          m.dispose();
        }
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
