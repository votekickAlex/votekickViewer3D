import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
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
          // Colors from an .mtl file are intentional; don't overwrite them.
          if ((mat as any).userData?.fromMtl) continue;
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

  const manager = new THREE.LoadingManager();
  manager.setURLModifier(urlModifier);

  const gltf = new GLTFLoader(manager).setResourcePath(resourcePath);
  const fbx = new FBXLoader(manager).setResourcePath(resourcePath);
  const obj = new OBJLoader(manager).setResourcePath(resourcePath);
  const stl = new STLLoader();
  const ply = new PLYLoader();
  const dae = new ColladaLoader(manager).setResourcePath(resourcePath);
  const tds = new TDSLoader(manager).setResourcePath(resourcePath);

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
    case ".fbx": {
      const object = await parseAsync(fbx, buffer, fileName);
      return wrap(object, (object as any).animations ?? []);
    }
    case ".obj": {
      if (buffer.byteLength >= OBJ_FAST_MIN_BYTES) {
        const geometry = parseObjFast(new Uint8Array(buffer));
        const colorAttr = geometry.getAttribute("color");
        const material =
          colorAttr && colorAttr.itemSize === 3
            ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.0 })
            : defaultMeshMaterial();
        return wrap(new THREE.Mesh(geometry, material));
      }
      return wrap(await parseObjWithMaterials(obj, manager, buffer));
    }
    case ".stl": {
      const geometry = stl.parse(buffer);
      geometry.computeVertexNormals();
      return wrap(new THREE.Mesh(geometry, defaultMeshMaterial()));
    }
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
      const collada = dae.parse(new TextDecoder().decode(buffer), resourcePath);
      const scene = collada?.scene;
      if (!scene) throw new Error("No scene found in Collada document");
      return wrap(scene, (scene as any).animations ?? []);
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

/** Parses a normal OBJ, picking up its sidecar .mtl (the `mtllib` line)
 * and the textures referenced inside it. Materials are tagged so the
 * generic prepare() step keeps their authored colors. */
async function parseObjWithMaterials(
  loader: OBJLoader,
  manager: THREE.LoadingManager,
  buffer: ArrayBuffer,
): Promise<THREE.Object3D> {
  const text = new TextDecoder().decode(buffer);
  // MTLLoader parses synchronously from text; textures load via the
  // manager's urlModifier (same folder as the model).
  const mtlMatch = /^\s*mtllib\s+(.+)$/im.exec(text);
  if (mtlMatch && resourceBase) {
    const mtlName = mtlMatch[1].trim().split(/\s+/)[0];
    try {
      const res = await fetch(urlModifier(mtlName));
      if (res.ok) {
        const mtlText = await res.text();
        const materials = new MTLLoader(manager).parse(mtlText, resourcePathForMtl());
        materials.preload();
        loader.setMaterials(materials);
      }
    } catch (err) {
      console.warn("Could not load .mtl sidecar", err);
    }
  }
  const object = loader.parse(text);
  // OBJLoader clones the MTL materials for each group; tag the final
  // meshes so prepare() keeps their authored colors and textures.
  if (mtlMatch && resourceBase) {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) m.userData.fromMtl = true;
    });
  }
  return object;
}

/** Base path passed to MTLLoader for texture resolution. */
function resourcePathForMtl(): string {
  return resourceBase.replace(/\/$/, "") + "/";
}

// ---------- fast OBJ parser (very large files) ----------

/** three's OBJLoader builds millions of small JS objects and grinds for
 * minutes on multi-hundred-MB files; over this threshold a byte-level
 * parser below is used instead (seconds, bounded memory). */
const OBJ_FAST_MIN_BYTES = 20 * 1024 * 1024;

/** Growable Float32Array storing values sequentially. */
class GrowableF32 {
  arr: Float32Array;
  len = 0;
  constructor(cap = 4096) {
    // Never start at zero capacity: ensure() doubles the capacity and
    // doubling zero stays zero forever.
    this.arr = new Float32Array(Math.max(cap, 16));
  }
  private ensure(extra: number): void {
    if (this.len + extra <= this.arr.length) return;
    let cap = this.arr.length * 2;
    while (cap < this.len + extra) cap *= 2;
    const next = new Float32Array(cap);
    next.set(this.arr);
    this.arr = next;
  }
  push3(x: number, y: number, z: number): void {
    this.ensure(3);
    let i = this.len;
    this.arr[i++] = x;
    this.arr[i++] = y;
    this.arr[i] = z;
    this.len += 3;
  }
  push2(x: number, y: number): void {
    this.ensure(2);
    this.arr[this.len++] = x;
    this.arr[this.len++] = y;
  }
}

/** Growable Int32Array storing values sequentially. */
class GrowableI32 {
  arr: Int32Array;
  len = 0;
  constructor(cap = 4096) {
    this.arr = new Int32Array(Math.max(cap, 16));
  }
  private ensure(extra: number): void {
    if (this.len + extra <= this.arr.length) return;
    let cap = this.arr.length * 2;
    while (cap < this.len + extra) cap *= 2;
    const next = new Int32Array(cap);
    next.set(this.arr);
    this.arr = next;
  }
  push3(x: number, y: number, z: number): void {
    this.ensure(3);
    let i = this.len;
    this.arr[i++] = x;
    this.arr[i++] = y;
    this.arr[i] = z;
    this.len += 3;
  }
}

const enum Bytes {
  TAB = 9,
  LF = 10,
  CR = 13,
  SPACE = 32,
  SLASH = 47,
  MINUS = 45,
  DOT = 46,
  ZERO = 48,
  NINE = 57,
  F = 70, // uppercase F never starts an OBJ keyword, but compare lowercase
  LOWER_E = 101,
  LOWER_F = 102,
  LOWER_N = 110,
  LOWER_T = 116,
  LOWER_V = 118,
}

/** Parses a float token bytes[s..e) without creating strings. Supports
 * sign, decimals and the e/E exponent. */
function readFloat(bytes: Uint8Array, s: number, e: number): number {
  let i = s;
  let sign = 1;
  if (bytes[i] === Bytes.MINUS) {
    sign = -1;
    i++;
  } else if (bytes[i] === 43 /* + */) {
    i++;
  }
  let int = 0;
  while (i < e) {
    const c = bytes[i];
    if (c < Bytes.ZERO || c > Bytes.NINE) break;
    int = int * 10 + (c - Bytes.ZERO);
    i++;
  }
  let val = int;
  if (i < e && bytes[i] === Bytes.DOT) {
    i++;
    let frac = 0;
    let div = 1;
    while (i < e) {
      const c = bytes[i];
      if (c < Bytes.ZERO || c > Bytes.NINE) break;
      frac = frac * 10 + (c - Bytes.ZERO);
      div *= 10;
      i++;
    }
    val += frac / div;
  }
  if (i < e && (bytes[i] === Bytes.LOWER_E || bytes[i] === 69 /* E */)) {
    i++;
    let esign = 1;
    if (bytes[i] === Bytes.MINUS) {
      esign = -1;
      i++;
    } else if (bytes[i] === 43) {
      i++;
    }
    let ex = 0;
    while (i < e) {
      const c = bytes[i];
      if (c < Bytes.ZERO || c > Bytes.NINE) break;
      ex = ex * 10 + (c - Bytes.ZERO);
      i++;
    }
    val *= Math.pow(10, esign * ex);
  }
  return sign * val;
}

/** Parses an OBJ face index (1-based, may be negative) at the shared
 * cursor; 0 means "absent". */
function readIndex(bytes: Uint8Array, end: number, cursor: { i: number }): number {
  let sign = 1;
  let val = 0;
  let has = false;
  if (cursor.i < end && bytes[cursor.i] === Bytes.MINUS) {
    sign = -1;
    cursor.i++;
  }
  while (cursor.i < end) {
    const c = bytes[cursor.i];
    if (c < Bytes.ZERO || c > Bytes.NINE) break;
    val = val * 10 + (c - Bytes.ZERO);
    has = true;
    cursor.i++;
  }
  return has ? sign * val : 0;
}

/** Parses an OBJ file straight from its bytes into a single indexed
 * BufferGeometry. Groups and usemtl are merged into one mesh (the app
 * shows a single default material anyway). Exported for tests. */
export function parseObjFast(bytes: Uint8Array): THREE.BufferGeometry {
  const v = new GrowableF32(1 << 16); // positions, triples
  const vn = new GrowableF32(0); // normals, triples
  const vt = new GrowableF32(0); // texture coords, pairs
  const cv = new GrowableF32(0); // vertex colors, triples (tail-aligned to v)
  const triP = new GrowableI32(1 << 15); // per triangle corner: position index
  const triT = new GrowableI32(0); // ... uv index
  const triN = new GrowableI32(0); // ... normal index

  let vCount = 0;
  let vnCount = 0;
  let vtCount = 0;
  let colorCount = 0;
  let colorsSeen = false;

  const nums = new Float64Array(8);
  // Per-face corner lists; faces rarely exceed a few dozen corners but the
  // growable arrays keep pathological fan faces (huge polygons) safe.
  let faceP: number[] = [];
  let faceT: number[] = [];
  let faceN: number[] = [];
  const cursor = { i: 0 };

  const emitFace = (): void => {
    for (let k = 2; k < faceP.length; k++) {
      triP.push3(faceP[0], faceP[k - 1], faceP[k]);
      triT.push3(faceT[0], faceT[k - 1], faceT[k]);
      triN.push3(faceN[0], faceN[k - 1], faceN[k]);
    }
    faceP.length = 0;
    faceT.length = 0;
    faceN.length = 0;
  };

  const n = bytes.length;
  let line = 0;
  while (line < n) {
    let lineEnd = line;
    while (lineEnd < n && bytes[lineEnd] !== Bytes.LF) lineEnd++;
    let end = lineEnd;
    if (end > line && bytes[end - 1] === Bytes.CR) end--;

    let j = line;
    const c0 = bytes[j++];
    if (c0 === Bytes.LOWER_V) {
      const c1 = j < end ? bytes[j] : -1;
      if (c1 === Bytes.SPACE || c1 === Bytes.TAB) {
        // "v x y z [w] [r g b]"
        j++;
        let count = 0;
        while (j < end && count < 8) {
          const c = bytes[j];
          if (c === Bytes.SPACE || c === Bytes.TAB) {
            j++;
            continue;
          }
          let tokenEnd = j;
          while (tokenEnd < end && bytes[tokenEnd] !== Bytes.SPACE && bytes[tokenEnd] !== Bytes.TAB) tokenEnd++;
          nums[count++] = readFloat(bytes, j, tokenEnd);
          j = tokenEnd;
        }
        if (count >= 3) {
          v.push3(nums[0], nums[1], nums[2]);
          vCount++;
          if (count >= 6) {
            const o = count === 7 ? 1 : 0;
            cv.push3(nums[3 + o], nums[4 + o], nums[5 + o]);
            colorCount++;
            colorsSeen = true;
          } else if (colorsSeen) {
            cv.push3(1, 1, 1); // keep colors aligned to positions
            colorCount++;
          }
        }
      } else if (c1 === Bytes.LOWER_N && (j + 1 < end) && (bytes[j + 1] === Bytes.SPACE || bytes[j + 1] === Bytes.TAB)) {
        // "vn x y z"
        j += 2;
        let count = 0;
        while (j < end && count < 3) {
          const c = bytes[j];
          if (c === Bytes.SPACE || c === Bytes.TAB) {
            j++;
            continue;
          }
          let tokenEnd = j;
          while (tokenEnd < end && bytes[tokenEnd] !== Bytes.SPACE && bytes[tokenEnd] !== Bytes.TAB) tokenEnd++;
          nums[count++] = readFloat(bytes, j, tokenEnd);
          j = tokenEnd;
        }
        if (count >= 3) {
          vn.push3(nums[0], nums[1], nums[2]);
          vnCount++;
        }
      } else if (c1 === Bytes.LOWER_T && (j + 1 < end) && (bytes[j + 1] === Bytes.SPACE || bytes[j + 1] === Bytes.TAB)) {
        // "vt u v [w]"
        j += 2;
        let count = 0;
        while (j < end && count < 3) {
          const c = bytes[j];
          if (c === Bytes.SPACE || c === Bytes.TAB) {
            j++;
            continue;
          }
          let tokenEnd = j;
          while (tokenEnd < end && bytes[tokenEnd] !== Bytes.SPACE && bytes[tokenEnd] !== Bytes.TAB) tokenEnd++;
          nums[count++] = readFloat(bytes, j, tokenEnd);
          j = tokenEnd;
        }
        if (count >= 2) {
          vt.push2(nums[0], nums[1]);
          vtCount++;
        }
      }
    } else if (c0 === Bytes.LOWER_F && j < end && (bytes[j] === Bytes.SPACE || bytes[j] === Bytes.TAB)) {
      // "f v[/vt][/vn] ..."
      j++;
      for (;;) {
        while (j < end && (bytes[j] === Bytes.SPACE || bytes[j] === Bytes.TAB)) j++;
        if (j >= end) break;
        cursor.i = j;
        let p = readIndex(bytes, end, cursor);
        let t = 0;
        let nn = 0;
        if (bytes[cursor.i] === Bytes.SLASH && cursor.i < end) {
          cursor.i++;
          if (cursor.i < end && bytes[cursor.i] !== Bytes.SLASH && bytes[cursor.i] !== Bytes.SPACE && bytes[cursor.i] !== Bytes.TAB) {
            t = readIndex(bytes, end, cursor);
          }
          if (cursor.i < end && bytes[cursor.i] === Bytes.SLASH) {
            cursor.i++;
            nn = readIndex(bytes, end, cursor);
          }
        }
        j = cursor.i;
        // Resolve OBJ indices (1-based, negative = from the end); invalid
        // corners are dropped rather than corrupting the mesh.
        const rp = p > 0 ? p - 1 : p < 0 ? vCount + p : -1;
        if (rp < 0 || rp >= vCount) continue;
        const rt = t > 0 ? t - 1 : t < 0 ? vtCount + t : -1;
        const rn = nn > 0 ? nn - 1 : nn < 0 ? vnCount + nn : -1;
        faceP.push(rp);
        faceT.push(rt);
        faceN.push(rn);
      }
      emitFace();
    }
    // All other keywords (o, g, usemtl, mtllib, s, l, p, #) are ignored.
    line = lineEnd + 1;
  }

  const cornerCount = triP.len;
  if (cornerCount === 0) throw new Error("No triangles found in OBJ file");

  let usesUv = false;
  let usesN = false;
  for (let k = 0; k < cornerCount; k++) {
    if (triT.arr[k] >= 0) usesUv = true;
    if (triN.arr[k] >= 0) usesN = true;
  }

  const geometry = new THREE.BufferGeometry();
  const colorOffset = vCount - colorCount; // vertices before the first color

  if (!usesUv && !usesN) {
    // Plain indexed geometry: zero attribute expansion, smallest memory.
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(v.arr.subarray(0, v.len)), 3));
    const index = new Uint32Array(cornerCount);
    for (let k = 0; k < cornerCount; k++) index[k] = triP.arr[k];
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    if (colorCount > 0) {
      const colors = new Float32Array(vCount * 3).fill(1);
      for (let c = 0; c < colorCount; c++) {
        colors[(colorOffset + c) * 3] = cv.arr[c * 3];
        colors[(colorOffset + c) * 3 + 1] = cv.arr[c * 3 + 1];
        colors[(colorOffset + c) * 3 + 2] = cv.arr[c * 3 + 2];
      }
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    }
  } else {
    // Mixed v/vt/vn indices: expand every corner into a flat attribute.
    const positions = new Float32Array(cornerCount * 3);
    for (let k = 0; k < cornerCount; k++) {
      const s = triP.arr[k] * 3;
      const o = k * 3;
      positions[o] = v.arr[s];
      positions[o + 1] = v.arr[s + 1];
      positions[o + 2] = v.arr[s + 2];
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    if (usesN) {
      const normals = new Float32Array(cornerCount * 3);
      for (let k = 0; k < cornerCount; k++) {
        const ni = triN.arr[k];
        if (ni < 0) continue;
        const s = ni * 3;
        const o = k * 3;
        normals[o] = vn.arr[s];
        normals[o + 1] = vn.arr[s + 1];
        normals[o + 2] = vn.arr[s + 2];
      }
      geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    }
    if (usesUv) {
      const uvs = new Float32Array(cornerCount * 2);
      for (let k = 0; k < cornerCount; k++) {
        const ti = triT.arr[k];
        if (ti < 0) continue;
        const s = ti * 2;
        uvs[k * 2] = vt.arr[s];
        uvs[k * 2 + 1] = vt.arr[s + 1];
      }
      geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    }
    if (colorCount > 0) {
      const colors = new Float32Array(cornerCount * 3).fill(1);
      for (let k = 0; k < cornerCount; k++) {
        const ci = triP.arr[k] - colorOffset;
        if (ci < 0) continue;
        const s = ci * 3;
        colors[k * 3] = cv.arr[s];
        colors[k * 3 + 1] = cv.arr[s + 1];
        colors[k * 3 + 2] = cv.arr[s + 2];
      }
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    }
  }

  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  return geometry;
}

/** Some three loaders expose parse() synchronously; wrap so errors propagate. */
async function parseAsync(
  loader: { parse(data: ArrayBuffer, path: string, onLoad?: (r: any) => void): any },
  buffer: ArrayBuffer,
  path: string,
): Promise<any> {
  return loader.parse(buffer, path, (r: any) => r);
}
