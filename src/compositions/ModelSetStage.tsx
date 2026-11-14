/**
 * src/compositions/ModelSetStage.tsx — a model set (docs/factory/19-model-sets.md):
 * one catalog model staged as the whole set, a ship on open sea or a
 * lighthouse on its islet, with the scene's featured actors on its spots.
 *
 * The model's file is read once per tab, under a delayRender hold: its bytes
 * give the set's layout (world/modelset: the floors, the solid boxes, the
 * spots, measured from the triangles, the same numbers the camera tests and
 * the planner use) and the drawn model (GLTFLoader on the same bytes, its
 * materials remade in the file's order, opaque meshes drawn in scene order).
 * A file that does not load is a stand-in box of the catalog's size, set out
 * the same way, so a missing model never cancels a render.
 *
 * Director contract: scene.kit = "model-set", scene.modelSet.model a listed
 * set (world/modelset/sets.ts); look.timeOfDay and look.weather; actors at
 * the set's spots; shots name its parts, spots and actors
 * (generator/camera/modelSet.ts). Every motion is a function of the frame.
 */
import { useEffect, useMemo, useState } from "react";
import { staticFile, useCurrentFrame, useDelayRender, useVideoConfig } from "remotion";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { SceneType, ShotSpec } from "../generator/spec.schema";
import { modelSetAnchors, modelSetCast, modelSetTable } from "../generator/camera/modelSet";
import { glbTriangles } from "../world/modelset/gltf";
import { modelSetDef, type ModelSetDef } from "../world/modelset/sets";
import { setLayout, type SetLayout } from "../world/modelset/stage";
import { ActorsLayer } from "../world/actors/Actors";
import { GradientSkyDome, WaterSurface } from "./water";
import { WeatherLayer } from "./weather";
import { ShotCamera } from "./camera/ShotCamera";
import { useSceneDrawOrder } from "./glb";

/** Sky and light per time of day, on the open sea. */
const SET_TOD: Record<string, { sky: [string, string]; hemi: number; amb: number; dirI: number; dirColor: string; dirPos: [number, number, number] }> = {
  noon: { sky: ["#4a9de0", "#c4dcee"], hemi: 0.95, amb: 0.5, dirI: 1.7, dirColor: "#fff6dd", dirPos: [40, 70, 30] },
  afternoon: { sky: ["#5aa6e4", "#d4e0cc"], hemi: 0.85, amb: 0.45, dirI: 1.55, dirColor: "#ffedcd", dirPos: [55, 50, 40] },
  golden: { sky: ["#f7a95f", "#f5dec6"], hemi: 0.8, amb: 0.5, dirI: 2.0, dirColor: "#ffce8f", dirPos: [-60, 18, 60] },
  overcast: { sky: ["#9fb4c8", "#cfd6dd"], hemi: 1.05, amb: 0.55, dirI: 0.6, dirColor: "#e8eefc", dirPos: [20, 60, 40] },
  dawn: { sky: ["#ffc08a", "#6a7099"], hemi: 0.65, amb: 0.5, dirI: 0.95, dirColor: "#ffcfa3", dirPos: [-50, 14, 70] },
  night: { sky: ["#16223a", "#27364f"], hemi: 0.62, amb: 0.5, dirI: 0.85, dirColor: "#b9d0ff", dirPos: [-45, 55, 50] },
};

interface LoadedSet {
  layout: SetLayout;
  /** The drawn model in model units (the stage scales and moves it). */
  model: THREE.Object3D;
}

const loader = new GLTFLoader();
const sets = new Map<string, Promise<LoadedSet>>();

/** A box of the catalog's size, in model units, standing on its base: a missing file's stand-in. */
function standInTriangles(def: ModelSetDef): Float64Array {
  const k = def.scale;
  const [w, h, d] = def.size.map((v) => v / k);
  const g = new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0).toNonIndexed();
  return Float64Array.from(g.attributes.position.array as Float32Array);
}

/** The set's file read once per tab: its layout and its model (or the stand-in's). */
function loadSet(def: ModelSetDef): Promise<LoadedSet> {
  const hit = sets.get(def.id);
  if (hit) return hit;
  const dir = def.file.slice(0, def.file.lastIndexOf("/") + 1);
  const p = fetch(staticFile(def.file))
    .then((r) => {
      if (!r.ok) throw new Error(`${def.file}: ${r.status}`);
      return r.arrayBuffer();
    })
    .then(async (buf) => {
      const layout = setLayout(def, glbTriangles(new Uint8Array(buf)).tris);
      const gltf = await loader.parseAsync(buf, staticFile(dir));
      // GLTFLoader makes each material when its textures decode, so material
      // ids follow decode timing; remake them in the file's own order (as
      // KitInstances.tsx loadKitModel does), the same in every tab.
      const order = (m: THREE.Material) => gltf.parser.associations.get(m)?.materials ?? 1e9;
      const used: THREE.Material[] = [];
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (!used.includes(m)) used.push(m);
      });
      const fresh = new Map<THREE.Material, THREE.Material>();
      used
        .map((m, i) => ({ m, i }))
        .sort((x, y) => order(x.m) - order(y.m) || x.i - y.i)
        .forEach(({ m }) => fresh.set(m, m.clone()));
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => fresh.get(m)!) : fresh.get(mesh.material)!;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      });
      return { layout, model: gltf.scene };
    })
    .catch((err: unknown) => {
      console.warn(`[model set] ${def.file} did not load (${err instanceof Error ? err.message : String(err)}); drawn as a stand-in box. Install the world asset packs: npm run world:assets`);
      const tris = standInTriangles(def);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(Float32Array.from(tris), 3));
      g.computeVertexNormals();
      const box = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: "#c9bfae", roughness: 0.92, flatShading: true }));
      return { layout: setLayout(def, tris), model: box };
    });
  sets.set(def.id, p);
  return p;
}

/** The islet under a lighthouse: rock falling into the sea, grass on its flat top, boulders. */
function Islet({ layout }: { layout: SetLayout }) {
  const isle = layout.islet!;
  const geo = useMemo(() => {
    const rings = 28;
    const sectors = 64;
    const reach = isle.edge + 3;
    const pos: number[] = [];
    const col: number[] = [];
    const grass = new THREE.Color("#6f8048");
    const rock = new THREE.Color("#7a7166");
    const wet = new THREE.Color("#4f4a45");
    const at = (ri: number, si: number): [number, number, number] => {
      const r = (ri / rings) * reach;
      const a = (si / sectors) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      return [x, layout.groundAt(x, z), z];
    };
    const paint = (y: number) => (y > -0.05 ? grass : y > layout.sea - 0.1 ? rock : wet);
    for (let ri = 0; ri < rings; ri++) {
      for (let si = 0; si < sectors; si++) {
        const a = at(ri, si);
        const b = at(ri + 1, si);
        const c = at(ri + 1, si + 1);
        const d = at(ri, si + 1);
        for (const tri of [[a, b, c], [a, c, d]]) {
          const y = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
          const cc = paint(y);
          // Wound so the faces look up (rings outward, sectors round +y).
          for (const v of [tri[0], tri[2], tri[1]]) {
            pos.push(...v);
            col.push(cc.r, cc.g, cc.b);
          }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }, [isle, layout]);
  return (
    <group>
      <mesh geometry={geo} receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.95} flatShading />
      </mesh>
      {isle.rocks.map((r, i) => (
        <mesh key={i} position={[r.x, r.y, r.z]} rotation={[i * 0.7, i * 1.3, 0]} castShadow receiveShadow>
          <dodecahedronGeometry args={[r.r, 0]} />
          <meshStandardMaterial color="#6e665c" roughness={0.95} flatShading />
        </mesh>
      ))}
    </group>
  );
}

const RIG_LENS = { fov: 45, near: 0.1, far: 2200 };

/** Without a shot: a slow three-quarter orbit round the set. */
function SetRig({ layout }: { layout: SetLayout }) {
  const { camera } = useThree();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  useFrame(() => {
    const cam = camera as THREE.PerspectiveCamera;
    if (cam.fov !== RIG_LENS.fov || cam.near !== RIG_LENS.near || cam.far !== RIG_LENS.far) {
      cam.fov = RIG_LENS.fov;
      cam.near = RIG_LENS.near;
      cam.far = RIG_LENS.far;
      cam.updateProjectionMatrix();
    }
    const t = frame / fps;
    const bow = Math.atan2(layout.front[0], layout.front[1]);
    const r = Math.max(layout.half.along * 2.2, layout.height * 1.25);
    const a = bow + 0.9 + t * 0.04;
    camera.position.set(Math.sin(a) * r, layout.sea + layout.height * 0.35, Math.cos(a) * r);
    camera.lookAt(0, layout.height * 0.35, 0);
  });
  return null;
}

/** What the stage draws once its set is in. */
function SetScene({ spec, scene, loaded, tod }: { spec: ShotSpec; scene: SceneType; loaded: LoadedSet; tod: string }) {
  const { layout } = loaded;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const model = useMemo(() => loaded.model.clone(true), [loaded]);
  const cast = useMemo(() => modelSetCast(scene, layout), [scene, layout]);
  const table = useMemo(() => modelSetTable(layout), [layout]);
  const anchors = useMemo(() => modelSetAnchors(scene, layout, cast), [scene, layout, cast]);
  const actorCast = useMemo(() => ({ plans: cast.plans, casting: cast.casting, warnings: cast.warnings }), [cast]);
  return (
    <>
      <group position={layout.shift} scale={layout.def.scale}>
        <primitive object={model} />
      </group>
      {layout.islet && <Islet layout={layout} />}
      <WaterSurface size={[600, 600]} segments={96} tod={tod} level={layout.sea} />
      {cast.scripts.length > 0 && <ActorsLayer scripts={cast.scripts} anchors={table} cast={actorCast} t={t} />}
      <ShotCamera spec={spec} anchors={anchors} fallback={<SetRig layout={layout} />} />
    </>
  );
}

export function ModelSetStage({ spec, scene }: { spec: ShotSpec; scene: SceneType }) {
  const tod = (scene.look?.timeOfDay ?? "noon") as string;
  const look = SET_TOD[tod] ?? SET_TOD.noon;
  const def = useMemo(() => modelSetDef(scene.modelSet?.model ?? ""), [scene.modelSet?.model]);
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const advance = useThree((s) => s.advance);
  const [loaded, setLoaded] = useState<{ id: string; set: LoadedSet } | null>(null);
  const [hold] = useState(() => ({ handle: def ? (delayRender(`model set ${def.id}`, { timeoutInMilliseconds: 120_000 }) as number | null) : null }));
  useSceneDrawOrder();

  useEffect(() => {
    if (!def) return;
    let live = true;
    loadSet(def)
      .then((set) => {
        if (live) setLoaded({ id: def.id, set });
      })
      .catch((err: unknown) => cancelRender(err instanceof Error ? err : new Error(String(err))));
    return () => {
      live = false;
    };
  }, [def, cancelRender]);

  const ready = loaded && def && loaded.id === def.id ? loaded.set : null;
  useEffect(() => {
    if (!ready) return;
    // Draw now, so the frame being captured has the set in it.
    advance(performance.now());
    if (hold.handle !== null) {
      continueRender(hold.handle);
      hold.handle = null;
    }
  }, [ready, advance, continueRender, hold]);
  useEffect(
    () => () => {
      if (hold.handle !== null) continueRender(hold.handle);
      hold.handle = null;
    },
    [continueRender, hold],
  );

  return (
    <>
      <GradientSkyDome top={look.sky[0]} bottom={look.sky[1]} />
      <fog attach="fog" args={[look.sky[1], 70, 380]} />
      <directionalLight
        position={look.dirPos}
        intensity={look.dirI}
        color={look.dirColor}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0006}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
        shadow-camera-far={220}
      />
      <hemisphereLight intensity={look.hemi} color={look.sky[0]} groundColor={look.sky[1]} />
      <ambientLight intensity={look.amb} />
      <WeatherLayer weather={scene.look?.weather ?? "none"} tod={tod} specId={spec.id} />
      {ready ? <SetScene spec={spec} scene={scene} loaded={ready} tod={tod} /> : null}
    </>
  );
}
