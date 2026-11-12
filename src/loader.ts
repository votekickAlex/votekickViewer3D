import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";
import { TDSLoader } from "three/examples/jsm/loaders/TDSLoader.js";

export const SUPPORTED_EXTENSIONS = [
  ".glb",
  ".gltf",
  ".fbx",
  ".obj",
  ".stl",
  ".ply",
  ".dae",
  ".3ds",
] as const;

export function isSupportedFile(name: string): boolean {
  const lower = name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Where sidecar textures live (folder next to the model file).
 * Populated by the app shell when opened through the OS integration;
 * empty in drag&drop mode, where the OS only gives us the file itself.
 */
let resourceBase = "";
export function setResourceBase(base: string): void {
  resourceBase = base;
}

/** True when a file is loadable purely from its own bytes (no sidecar textures). */
export function isSelfContained(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".glb") || lower.endsWith(".stl") || lower.endsWith(".ply");
}

function urlModifier(url: string): string {
  if (resourceBase && !/^(https?:|data:|blob:)/i.test(url)) {
    const encoded = url.split(/[\\/]/).map(encodeURIComponent).join("/");
    return resourceBase.replace(/\/$/, "") + "/" + encoded;
  }
  return url;
}

/** May be called before or after loading to decorate meshes with colors. */
function prepare(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;

    // Materials without any color data (STL/PLY have none) get a neutral look.
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of materials) {
      const mat = m as THREE.MeshStandardMaterial;
      if (mat && (mat as any).isMaterial) {
        if (mat.type === "MeshStandardMaterial" || mat.type === "MeshPhongMaterial") {
          if (!mat.map) {
            mat.color = new THREE.Color(0xb0b4bc);
            mat.metalness = 0.0;
            mat.roughness = 0.55;
            mat.needsUpdate = true;
          }
        }
      }
    }

    // Shadows are cheap enough and improve depth perception.
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  });
}

export type LoadResult = {
  object: THREE.Object3D;
  animations: THREE.AnimationClip[];
  name: string;
};

export async function loadFromArrayBuffer(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<LoadResult> {
  const ext = fileName.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
  const resourcePath = resourceBase || "./";

  const gltf = new GLTFLoader().setResourcePath(resourcePath);
  const fbx = new FBXLoader().setResourcePath(resourcePath);
  const obj = new OBJLoader().setResourcePath(resourcePath);
  const stl = new STLLoader();
  const ply = new PLYLoader();
  const dae = new ColladaLoader().setResourcePath(resourcePath);
  const tds = new TDSLoader().setResourcePath(resourcePath);

  const wrap = (object: THREE.Object3D, animations: THREE.AnimationClip[] = []): LoadResult => {
    prepare(object);
    return { object, animations, name: fileName };
  };

  switch (ext) {
    case ".glb":
    case ".gltf": {
      const gltfScene = await new Promise<any>((resolve, reject) =>
        gltf.parse(buffer, resourcePath, resolve, reject),
      );
      return wrap(gltfScene.scene ?? gltfScene.scenes[0], gltfScene.animations ?? []);
    }
    case ".fbx":
      return wrap(await parseAsync(fbx, buffer, fileName), fbx.animations ?? []);
    case ".obj":
      return wrap(obj.parse(new TextDecoder().decode(buffer)));
    case ".stl":
      return wrap(new THREE.Mesh(stl.parse(buffer), defaultMeshMaterial()));
    case ".ply": {
      const geometry = ply.parse(buffer);
      geometry.computeVertexNormals();
      const hasVertexColors =
        geometry.hasAttribute("color") &&
        geometry.getAttribute("color").itemSize === 3;
      const material = hasVertexColors
        ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 })
        : defaultMeshMaterial();
      return wrap(new THREE.Mesh(geometry, material));
    }
    case ".dae": {
      const collada = await dae.parseAsync(new TextDecoder().decode(buffer), resourcePath);
      return wrap(collada.scene, collada.scene.animations ?? []);
    }
    case ".3ds":
      return wrap(await parseAsync(tds, buffer, fileName));
    default:
      throw new Error(`Unsupported format: ${ext || "unknown"}`);
  }
}

function defaultMeshMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xb0b4bc, roughness: 0.55, metalness: 0.0 });
}

/** Some three loaders expose parse() synchronously; wrap so errors propagate. */
async function parseAsync(
  loader: { parse(data: ArrayBuffer, path: string, onLoad?: (r: any) => void): any },
  buffer: ArrayBuffer,
  path: string,
): Promise<any> {
  return loader.parse(buffer, path, (r: any) => r);
}
