import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const BG_COLOR = 0x1c1f24;
const GRID_COLOR = 0x3a3f47;
const GRID_CENTER_COLOR = 0x565d68;

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  private grid: THREE.Group;
  private modelRoot: THREE.Group;
  private wireframe = false;

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

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(5, 10, 7);
    this.scene.add(sun);

    this.grid = this.createGrid();
    this.scene.add(this.grid);

    this.modelRoot = new THREE.Group();
    this.scene.add(this.modelRoot);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
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
    this.frameModel();
  }

  clearModel(): void {
    this.disposeModel();
  }

  frameModel(): void {
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

    // Keep camera direction, just move to the right distance.
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (dir.lengthSq() < 1e-6) dir.set(0.7, 0.4, 1).normalize();

    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, distance);

    // Dynamic near/far so huge and tiny models both render correctly.
    this.camera.near = Math.max(maxDim / 1000, 0.001);
    this.camera.far = Math.max(distance * 100, 100);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  setGridVisible(visible: boolean): void {
    this.grid.visible = visible;
  }

  get gridVisible(): boolean {
    return this.grid.visible;
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
    this.renderer.setSize(w, h);
  }
}
