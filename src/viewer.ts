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

/** Small margin added when fitting the bounding box to the viewport, so
 * the box edges do not touch the screen border ("bbox plus a few
 * pixels"). */
const FIT_MARGIN = 1.04;

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
/** An axis the camera looks straight along is drawn in this gray. */
const AXIS_DIM_COLOR = 0x808690;

/** Hex colors of the status bar XYZ readout, mirroring the scene
 * constants so the letters always match the gizmo lines. */
export const AXIS_COLOR_HEX = {
  x: "#d95454",
  y: "#4a90d9",
  z: "#5aa02c",
  dim: "#808690",
} as const;

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  private grid: THREE.Group;
  /** Current cell size of the adaptive grid (world units). */
  private gridCell = 1;
  /** Grid color as set by Settings; kept so an adaptive rebuild keeps it. */
  private gridHex = DEFAULT_GRID_COLOR;
  /** Grid divisions per side: the extent is always this many cells. */
  private static readonly GRID_CELLS = 20;
  /** The three axis lines through the origin, separate from the grid so
   * they stay visible when the grid is off; dimmed gray when the camera
   * looks straight along one of them. */
  private readonly axesGroup = new THREE.Group();
  private axisMaterials: THREE.LineBasicMaterial[] = [];
  private axisDim: "x" | "y" | "z" | null = null;
  /** Set by main.ts: notified when the dimmed axis changes, so the
   * status bar XYZ readout recolors in the same frame as the gizmo. */
  onAxisDimChange: ((axis: "x" | "y" | "z" | null) => void) | null = null;
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

    // Dev-only console hook for debugging the fit and scene content.
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__viewer = this;
    }

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

    // Orbiting and panning act on the active camera, while the fit reads
    // the view direction from the perspective one: keep the inactive
    // camera on the same line through the target, so an orthographic
    // orbit followed by reset view fits along the rotated direction
    // instead of the stale one.
    this.controls.addEventListener("change", () => {
      const dir = this.activeCamera.position.clone().sub(this.controls.target);
      (this.orthoOn ? this.camera : this.orthoCamera).position
        .copy(this.controls.target).add(dir);
    });

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

    this.grid = this.createGrid(DEFAULT_GRID_COLOR, this.gridCell);
    this.scene.add(this.grid);
    this.createAxes(Viewer.GRID_CELLS * this.gridCell / 2);
    this.scene.add(this.axesGroup);

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
      this.updateAxisDim();
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

  /** Smallest value from the 1-2-5 ladder that is >= x, so grid cells
   * always read as round numbers (0.1, 0.2, 0.5, 1, 2, 5, 10, ...). */
  private static niceCell(x: number): number {
    if (!isFinite(x) || x <= 0) return 1;
    const base = Math.pow(10, Math.floor(Math.log10(x)));
    // The mantissa x / base lies in [1, 10): compare it with a relative
    // tolerance wide enough to absorb float32 vertex noise in the bbox
    // size (about 1e-7 relative), so a 0.05 model cannot skip to 0.01.
    const scaled = x / base;
    for (const m of [1, 2, 5]) {
      if (scaled <= m * (1 + 1e-6)) return m * base;
    }
    return 10 * base;
  }

  /** Adapts the grid to the model: the cell comes from the 1-2-5 ladder
   * so the model's largest dimension spans roughly 10-20 cells, and the
   * extent stays GRID_CELLS cells wide. Rebuilds only when the ladder
   * cell actually changes (ladder steps are 2x or more apart). */
  private adaptGrid(maxDim: number): void {
    const cell = Viewer.niceCell(maxDim / 10);
    if (cell === this.gridCell) return;
    this.gridCell = cell;
    this.rebuildGrid();
  }

  private createGrid(gridHex: string, cell: number): THREE.Group {
    const group = new THREE.Group();
    const { color, alpha } = parseHexColor(gridHex);
    const extent = Viewer.GRID_CELLS * cell;

    const grid = new THREE.GridHelper(extent, Viewer.GRID_CELLS, GRID_CENTER_COLOR, color.getHex());
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
    // (Blender's ground plane axes). For GridHelper(N, N) the line block
    // i occupies vertices 4i..4i+3: 4i/4i+1 are the line along X,
    // 4i+2/4i+3 the line along Z, so the center block starts at
    // 4 * (N / 2).
    const base = 4 * (Viewer.GRID_CELLS / 2);
    const colors = grid.geometry.getAttribute("color") as THREE.BufferAttribute;
    const red = new THREE.Color(AXIS_X_COLOR);
    const green = new THREE.Color(AXIS_Z_COLOR);
    for (const v of [base, base + 1]) colors.setXYZ(v, red.r, red.g, red.b);
    for (const v of [base + 2, base + 3]) colors.setXYZ(v, green.r, green.g, green.b);
    group.add(grid);
    return group;
  }

  /** Rebuilds the grid for the current cell size and color and rescales
   * the axis lines, which span the grid. */
  private rebuildGrid(): void {
    const visible = this.grid.visible;
    this.disposeLines(this.grid);
    this.grid = this.createGrid(this.gridHex, this.gridCell);
    this.grid.visible = visible;
    this.scene.add(this.grid);
    this.createAxes(Viewer.GRID_CELLS * this.gridCell / 2);
  }

  /** Rebuilds the three axis lines through the origin, spanning the grid.
   * Separate from the grid group so they survive grid toggles, color
   * changes and adaptive rebuilds. */
  private createAxes(halfExtent: number): void {
    this.disposeLines(this.axesGroup);
    this.axesGroup.clear();
    this.axisMaterials = [];
    const line = (dir: THREE.Vector3, color: number): THREE.Line => {
      const material = new THREE.LineBasicMaterial({ color, toneMapped: false, depthTest: false });
      this.axisMaterials.push(material);
      const geo = new THREE.BufferGeometry().setFromPoints([
        dir.clone().multiplyScalar(-halfExtent),
        dir.clone().multiplyScalar(halfExtent),
      ]);
      const l = new THREE.Line(geo, material);
      l.renderOrder = 10;
      return l;
    };
    this.axesGroup.add(line(new THREE.Vector3(1, 0, 0), AXIS_X_COLOR));
    this.axesGroup.add(line(new THREE.Vector3(0, 1, 0), AXIS_Y_COLOR));
    this.axesGroup.add(line(new THREE.Vector3(0, 0, 1), AXIS_Z_COLOR));
    this.applyAxisDim();
  }

  /** Disposes the geometries and materials of every line in a group (the
   * root Group itself has neither). */
  private disposeLines(group: THREE.Group): void {
    group.traverse((obj) => {
      const line = obj as THREE.Line;
      if (!line.geometry || !line.material) return;
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    });
  }

  /** Paints the axis materials: the axis the camera looks straight along
   * is gray, the others keep their colors. Called from the render loop
   * (cheap: guarded by the cached state) and after an axes rebuild. */
  private applyAxisDim(): void {
    const dimmed = new THREE.Color(AXIS_DIM_COLOR);
    this.axisMaterials[0]?.color.set(this.axisDim === "x" ? dimmed : AXIS_X_COLOR);
    this.axisMaterials[1]?.color.set(this.axisDim === "y" ? dimmed : AXIS_Y_COLOR);
    this.axisMaterials[2]?.color.set(this.axisDim === "z" ? dimmed : AXIS_Z_COLOR);
  }

  /** Tracks which axis the active camera looks along (either direction);
   * null when the view is not axis aligned. */
  private updateAxisDim(): void {
    const dir = this.activeCamera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-12) return;
    dir.normalize();
    let dim: "x" | "y" | "z" | null = null;
    if (Math.abs(dir.x) > 0.999) dim = "x";
    else if (Math.abs(dir.y) > 0.999) dim = "y";
    else if (Math.abs(dir.z) > 0.999) dim = "z";
    if (dim === this.axisDim) return;
    this.axisDim = dim;
    this.applyAxisDim();
    this.onAxisDimChange?.(dim);
  }

  /** Axis the camera currently looks straight along (gray in the gizmo
   * and in the status bar XYZ readout), null when not axis aligned. */
  get dimmedAxis(): "x" | "y" | "z" | null {
    return this.axisDim;
  }

  /** Axes stay visible no matter what the grid does; the interface
   * hidden state (H) is the only thing that turns them off. */
  setAxesVisible(visible: boolean): void {
    this.axesGroup.visible = visible;
  }

  setModel(object: THREE.Object3D): void {
    this.disposeModel();
    this.modelRoot.add(object);
    this.applyWireframe();
    this.refreshBBox();
    // A fresh model starts from the canonical orientation: drop any roll
    // a previous session left on the cameras (a top view yaw orbit spins
    // the up vector, and frameModel would carry it over).
    this.camera.up.set(0, 1, 0);
    this.orthoCamera.up.set(0, 1, 0);
    this.frameModel(true);
  }

  clearModel(): void {
    this.disposeModel();
    this.refreshBBox();
    // Back to the default one-unit grid for the empty scene.
    if (this.gridCell !== 1) {
      this.gridCell = 1;
      this.rebuildGrid();
    }
  }

  frameModel(resetAngle = false): void {
    if (this.modelRoot.children.length === 0) return;

    const box = new THREE.Box3().setFromObject(this.modelRoot);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    if (!isFinite(maxDim) || maxDim === 0) return;
    this.adaptGrid(maxDim);

    // Reset view returns to the canonical angle; otherwise keep the
    // current camera direction and just move to the fitting distance.
    const dir = this.camera.position.clone().sub(this.controls.target);
    if (resetAngle || dir.lengthSq() < 1e-6) dir.set(3, 2, 4);
    dir.normalize();

    // Fit the actual bounding box into the viewport instead of its
    // bounding sphere: the sphere wastes space on flat or elongated
    // models. Every box corner must stay inside both half angles; with
    // the camera at distance D from the center, a corner c (depth z
    // toward the camera, screen offsets cx, cy) needs
    // D >= z + max(cx / tanH, cy / tanV).
    // Camera basis for the fit constraints. It must match the orientation
    // place() will produce, so the roll comes from the active camera's
    // up vector: numpad yaw orbits spin that up in the top/bottom views
    // (the direction is parallel to the orbit axis there) and reset view
    // must keep the spun roll. A direction parallel to the up vector
    // falls back to the Z convention shared with the view presets.
    const activeUp = (this.orthoOn ? this.orthoCamera : this.camera).up;
    const upHint = activeUp.clone().normalize();
    if (Math.abs(upHint.dot(dir)) > 0.999) {
      upHint.set(0, 0, dir.y > 0 ? -1 : 1);
    }
    const right = new THREE.Vector3().crossVectors(upHint, dir).normalize();
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const tanH = tanV * this.camera.aspect;
    const aspect = this.camera.aspect;
    let distance = 0;
    let orthoHalfH = 0;
    const corner = new THREE.Vector3();
    const cornerOffsets: THREE.Vector3[] = [];
    for (let i = 0; i < 8; i++) {
      corner.set(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z,
      ).sub(center);
      cornerOffsets.push(corner.clone());
      const z = corner.dot(dir);
      const cx = Math.abs(corner.dot(right));
      const cy = Math.abs(corner.dot(up));
      distance = Math.max(distance, z + Math.max(cx / tanH, cy / tanV));
      orthoHalfH = Math.max(orthoHalfH, cy, cx / aspect);
    }
    distance *= FIT_MARGIN;
    orthoHalfH *= FIT_MARGIN;

    /** Places both cameras along the view direction at `d` with the
     * current ortho half height. The up vector matches the fit basis (a
     * view direction parallel to Y needs the Z fallback) and the
     * synchronous lookAt keeps the camera matrices valid for the
     * projections the fit loops read right after (no frame in between). */
    const orthoFit = { halfH: orthoHalfH };
    const place = (d: number): void => {
      this.controls.target.copy(center);
      this.camera.up.copy(upHint);
      this.orthoCamera.up.copy(upHint);
      const pos = center.clone().addScaledVector(dir, d);
      this.camera.position.copy(pos);
      this.camera.lookAt(center);
      this.orthoCamera.position.copy(pos);
      this.orthoCamera.lookAt(center);
      this.orthoCamera.zoom = 1;
      this.orthoHalfH = orthoFit.halfH;
      this.updateOrthoFrustum();
    };

    const ortho = this.orthoOn;
    const cam: THREE.Camera = ortho ? this.orthoCamera : this.camera;
    place(distance);

    // Depth of the front face toward the camera: zooming in must never
    // move the camera inside the box.
    let zMax = -Infinity;
    for (const c of cornerOffsets) zMax = Math.max(zMax, c.dot(dir));
    const minDistance = zMax + maxDim * 0.02 + 1e-6;

    // Fill the viewport with the box, FIT_MARGIN of breathing room.
    const targetSpan = 2 / FIT_MARGIN;

    /** Projects the box and returns the larger of the two fill ratios
     * (projected span over the allowed span); 1 means exactly filled. */
    const fillRatio = (d: number): number => {
      place(d);
      cam.updateMatrixWorld(true);
      let maxY = -2;
      let minY = 2;
      let maxX = -2;
      let minX = 2;
      for (const c of cornerOffsets) {
        const p = c.clone().add(center).project(cam);
        if (p.y > maxY) maxY = p.y;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.x < minX) minX = p.x;
      }
      return Math.max((maxY - minY) / targetSpan, (maxX - minX) / targetSpan);
    };

    if (ortho) {
      // Orthographic projection is linear in the frustum height, so a
      // single exact step lands on the target size.
      orthoFit.halfH *= fillRatio(distance);
      place(distance);
    } else {
      // In perspective the projected span depends on the corner depths,
      // and centering shifts near corners more than far ones, so the
      // distance and the centering must be solved together.
      distance = this.fitPerspDistance(minDistance);
    }

    // Centering: equal gaps on all four sides of the viewport.
    this.centerProjection();

    // Dynamic near/far so huge and tiny models both render correctly.
    this.camera.near = Math.max(maxDim / 1000, 0.001);
    this.camera.far = Math.max(distance * 100, 100);
    this.camera.updateProjectionMatrix();
    this.orthoCamera.near = this.camera.near;
    this.orthoCamera.far = this.camera.far;
    this.controls.update();
  }

  /** Recenters the projected bounding box on screen so the gaps are
   * equal on all four viewport sides. Runs after fitting and after
   * orthographic toggles. Pass `precomputed` to skip the (expensive)
   * scene traversal when the caller already measured the box. */
  private centerProjection(precomputed?: THREE.Box3): void {
    if (this.modelRoot.children.length === 0) return;
    const box = precomputed ?? new THREE.Box3().setFromObject(this.modelRoot);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const cam = this.activeCamera;

    // Camera basis: right = up x dir (the camera looks along -dir), and
    // the true up is recomputed from it, so shifts along these axes move
    // the image exactly horizontally / vertically.
    const dir = cam.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-12) dir.set(0, 0, 1);
    dir.normalize();
    // Guard against a view direction parallel to the up vector (would
    // produce a zero cross product): fall back to a Z up, mirroring the
    // top/bottom view presets.
    const upHint = Math.abs(cam.up.dot(dir)) > 0.999
      ? new THREE.Vector3(0, 0, dir.y > 0 ? -1 : 1)
      : cam.up.clone();
    const right = new THREE.Vector3().crossVectors(upHint, dir).normalize();
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();

    // World units that correspond to one NDC unit at the box center.
    const ortho = this.orthoOn;
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const tanH = tanV * this.camera.aspect;
    const distance = Math.max(cam.position.distanceTo(this.controls.target), 1e-6);
    const worldPerNdcY = ortho ? this.orthoHalfH : distance * tanV;
    const worldPerNdcX = ortho ? this.orthoHalfH * this.camera.aspect : distance * tanH;

    const corners: THREE.Vector3[] = [];
    for (let i = 0; i < 8; i++) {
      corners.push(
        new THREE.Vector3(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z,
        ).sub(center),
      );
    }

    /** Shifts the image along `axis` by `shiftNdc` NDC units (both
     * cameras and the orbit target move, so the view direction and the
     * pivot stay consistent). */
    const shiftImage = (axis: THREE.Vector3, shiftNdc: number, worldPerNdc: number): void => {
      const world = axis.clone().multiplyScalar(-shiftNdc * worldPerNdc);
      this.camera.position.add(world);
      this.orthoCamera.position.add(world);
      this.controls.target.add(world);
      cam.updateMatrixWorld(true);
    };

    /** Centers the box along one screen axis so the gaps on both sides
     * are equal; `pick` reads the NDC component. In ortho the NDC
     * response to a lateral shift is exactly 1 for every depth, so one
     * full-residual step is exact. In perspective the response of a
     * corner is dist/depth (near corners move more), so the step is the
     * Newton step; a plain half-residual step oscillates on flat or
     * close-up views. */
    const centerAxis = (
      axis: THREE.Vector3,
      worldPerNdc: number,
      pick: (p: THREE.Vector3) => number,
    ): void => {
      for (let iter = 0; iter < 6; iter++) {
        cam.updateMatrixWorld(true);
        const camPos = cam.position;
        let maxA = -2;
        let minA = 2;
        let dMax = distance;
        let dMin = distance;
        for (const c of corners) {
          const v = c.clone().add(center);
          // Depth toward the camera along the view direction (positive
          // for points in front of the camera); lateral shifts never
          // change it, so it stays valid across iterations.
          const depth = Math.max(
            distance * 0.01,
            camPos.clone().sub(v).dot(dir),
          );
          const a = pick(v.project(cam));
          if (a > maxA) {
            maxA = a;
            dMax = depth;
          }
          if (a < minA) {
            minA = a;
            dMin = depth;
          }
        }
        const residual = -(maxA + minA);
        // A lateral shift of s NDC moves BOTH projected extremes by s
        // (exactly in ortho, by s*dist/depth per corner in perspective),
        // so the sum response is 2s: the exact ortho step is half the
        // residual. In perspective the response per corner is depth
        // weighted, and solving sum - s*dist*(1/dMax + 1/dMin) = 0 gives
        // the Newton factor below; a plain half-residual step oscillates
        // on flat or close-up views. Break on the RESIDUAL, not on the
        // step size: with strongly different corner depths the step is
        // much smaller than the residual it exactly cancels.
        const shiftNdc = ortho
          ? residual / 2
          : residual * dMax * dMin / (distance * (dMax + dMin));
        if (!isFinite(shiftNdc) || Math.abs(maxA + minA) < 0.0015) break;
        shiftImage(axis, shiftNdc, worldPerNdc);
      }
    };

    centerAxis(up, worldPerNdcY, (p) => p.y);
    centerAxis(right, worldPerNdcX, (p) => p.x);
  }

  setGridVisible(visible: boolean): void {
    this.grid.visible = visible;
  }

  get gridVisible(): boolean {
    return this.grid.visible;
  }

  /** Current grid cell in world units, null when the grid is hidden:
   * the status bar shows it as the measurement unit for the model size. */
  get gridStep(): number | null {
    return this.grid.visible ? this.gridCell : null;
  }

  /** Rebuilds the grid with a new color (Settings > Colors); visibility
   * and the adaptive cell size are preserved. */
  setGridColor(hex: string): void {
    this.gridHex = hex;
    const visible = this.grid.visible;
    this.disposeLines(this.grid);
    this.grid = this.createGrid(hex, this.gridCell);
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

  /** Bisects the perspective camera distance along the current view
   * direction until the screen-centered bounding box exactly fills the
   * viewport with FIT_MARGIN of breathing room, never closer than
   * `minDistance`. Centering runs inside the measurement: centering a
   * perspective view shifts near corners more than far ones, which
   * changes the projected span, so the distance and the centering must
   * be solved together. Leaves the camera fitted and centered. */
  private fitPerspDistance(minDistance?: number): number {
    const cam = this.camera;
    const target0 = this.controls.target.clone();
    const dir = cam.position.clone().sub(target0);
    if (dir.lengthSq() < 1e-12) dir.set(0, 0, 1);
    dir.normalize();
    const box = new THREE.Box3().setFromObject(this.modelRoot);
    if (box.isEmpty()) return cam.position.distanceTo(target0);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    let zMax = -Infinity;
    for (let i = 0; i < 8; i++) {
      zMax = Math.max(
        zMax,
        new THREE.Vector3(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z,
        ).sub(center).dot(dir),
      );
    }
    // The camera must never end up inside the box, whatever the caller
    // asks for.
    const minD = Math.max(minDistance ?? 0, zMax + maxDim * 0.02 + 1e-6);

    const corners: THREE.Vector3[] = [];
    for (let i = 0; i < 8; i++) {
      corners.push(
        new THREE.Vector3(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z,
        ),
      );
    }
    const targetSpan = 2 / FIT_MARGIN;

    /** Fill ratio at distance `d` with the box screen-centered. The
     * camera is placed relative to the LIVE orbit target: centering
     * shifts the target sideways, and placing relative to a stale point
     * would skew the axis centerProjection solves against. */
    const ratio = (d: number): number => {
      cam.position.copy(this.controls.target).addScaledVector(dir, d);
      cam.lookAt(this.controls.target);
      this.centerProjection(box);
      cam.updateMatrixWorld(true);
      let maxY = -2;
      let minY = 2;
      let maxX = -2;
      let minX = 2;
      for (const c of corners) {
        const p = c.clone().project(cam);
        if (p.y > maxY) maxY = p.y;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.x < minX) minX = p.x;
      }
      return Math.max((maxY - minY) / targetSpan, (maxX - minX) / targetSpan);
    };

    // The ratio decreases monotonically with the distance, so bisect.
    // The lower bound always has ratio > 1 (the camera is nearly inside
    // the box there), so the bracket is valid.
    let lo = minD;
    let hi = Math.max(minD * 4, cam.position.distanceTo(this.controls.target) * 4);
    let guard = 0;
    while (ratio(hi) > 1 && guard++ < 20) hi *= 2;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (ratio(mid) > 1) lo = mid;
      else hi = mid;
    }
    ratio((lo + hi) / 2);
    return (lo + hi) / 2;
  }

  /** Toggles between the perspective and the orthographic camera, keeping
   * the on-screen scale and the camera position/target. */
  setOrthographic(on: boolean): void {
    if (on === this.orthoOn) return;
    const from = this.activeCamera;
    const dir = from.position.clone().sub(this.controls.target);
    let matched = Infinity;
    if (on) {
      // Entering ortho: frustum matches the current perspective view.
      const dist = Math.max(dir.length(), 1e-6);
      this.orthoHalfH =
        Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * dist;
      this.orthoCamera.zoom = 1;
      this.orthoCamera.position.copy(from.position);
      this.updateOrthoFrustum();
    } else {
      // Leaving ortho: the matched distance keeps the frustum scale at
      // the focus depth, but perspective magnifies nearer box parts, so
      // the matched view can clip the viewport. The fit below solves the
      // distance and the centering together; it never moves closer than
      // the matched distance, so a safe matched view keeps its scale.
      matched =
        this.orthoHalfH / this.orthoCamera.zoom /
        Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
      dir.setLength(matched);
      this.camera.position.copy(this.controls.target).add(dir);
    }
    this.camera.up.copy(from.up);
    this.orthoCamera.up.copy(from.up);
    this.orthoOn = on;
    this.controls.object = this.activeCamera;
    this.controls.update();
    if (!on) {
      this.camera.lookAt(this.controls.target);
      this.fitPerspDistance(matched);
      this.controls.update();
    }
    // Recenter the box on screen so the gaps stay equal in the new
    // projection.
    this.centerProjection();
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
   * view direction and the up vector from being parallel. Like reset
   * view, the model is fitted to the viewport along the new direction. */
  setViewPreset(preset: "front" | "back" | "left" | "right" | "top" | "bottom"): void {
    if (this.modelRoot.children.length === 0) return;
    const dirs: Record<typeof preset, [number, number, number]> = {
      front: [0, 0, 1],
      back: [0, 0, -1],
      right: [1, 0, 0],
      left: [-1, 0, 0],
      top: [0, 1, 0],
      bottom: [0, -1, 0],
    };
    const cam = this.activeCamera;
    const old = cam.position.clone().sub(this.controls.target);
    const dist = old.length() > 1e-6 ? old.length() : 5;
    // Anchor the preset to the model center: the orbit target may have
    // been shifted by the screen centering, which would throw the box
    // off screen otherwise. Both cameras go onto the preset line, and
    // frameModel(false) fits along it (it keeps the current direction).
    const presetDir = new THREE.Vector3(...dirs[preset]);
    const box = new THREE.Box3().setFromObject(this.modelRoot);
    const center = box.isEmpty()
      ? this.controls.target.clone()
      : box.getCenter(new THREE.Vector3());
    const pos = center.clone().addScaledVector(presetDir, dist);
    this.controls.target.copy(center);
    this.camera.position.copy(pos);
    this.orthoCamera.position.copy(pos);
    // Canonical up per preset: +Y everywhere except the top/bottom views,
    // where the Z fallback keeps the up vector from being parallel to
    // the view direction. frameModel(false) picks this up as its fit
    // basis and place() re-applies it to both cameras.
    const presetUp = preset === "top" || preset === "bottom"
      ? new THREE.Vector3(0, 0, -1)
      : new THREE.Vector3(0, 1, 0);
    this.camera.up.copy(presetUp);
    this.orthoCamera.up.copy(presetUp);
    this.frameModel(false);
  }

  /** Orbits the camera around the target: yaw around world up, pitch
   * around the view's horizontal (right) axis. Used by numpad 2/4/6/8.
   * In the top/bottom views the direction is parallel to the orbit axis,
   * so the yaw spins the camera roll instead, like Blender does. */
  orbitView(yawDeg: number, pitchDeg: number): void {
    const cam = this.activeCamera;
    const dir = cam.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-12) return;
    if (yawDeg !== 0) {
      if (Math.abs(dir.dot(UP)) / dir.length() > 0.999) {
        cam.up.applyAxisAngle(UP, THREE.MathUtils.degToRad(yawDeg));
      } else {
        dir.applyAxisAngle(UP, THREE.MathUtils.degToRad(yawDeg));
      }
    }
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

  /** Numpad 9: jumps to the opposite side of the current view and fits
   * the model like reset view does. */
  flipView(): void {
    if (this.modelRoot.children.length === 0) return;
    const cam = this.activeCamera;
    const dir = cam.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-12) return;
    // Flip around the model center so the box stays centered on screen;
    // frameModel(false) fits along the mirrored direction.
    const box = new THREE.Box3().setFromObject(this.modelRoot);
    const pivot = box.isEmpty() ? this.controls.target.clone() : box.getCenter(new THREE.Vector3());
    const pos = pivot.clone().sub(dir);
    this.controls.target.copy(pivot);
    this.camera.position.copy(pos);
    this.orthoCamera.position.copy(pos);
    this.frameModel(false);
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
