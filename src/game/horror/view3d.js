/**
 * view3d.js
 *
 * Draws the Dark House in 3D with Three.js, loaded from a CDN (pinned) only when the
 * game is opened, like the camera's MediaPipe. It renders off-screen at the scene's
 * size (960 x 540, so the GPU cost doesn't grow with the screen) and the hub copies
 * the picture onto the game canvas.
 *
 * The flashlight is the only light: one spotlight on the camera, black fog, nothing
 * else. Keys glint a little and the monster's eyes glow, so they're findable in the
 * dark. The monster is a few hundred triangles of plain shapes, built here: no model
 * file.
 */

import { CELL } from "./game.js";

const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
const WALL_HEIGHT = 2.6;
const EYE_HEIGHT = 1.6;

let loading = null;
/** @returns {Promise<typeof import("three")>} */
export function loadThree() {
  loading ??= import(THREE_URL);
  return loading;
}

/**
 * @param {typeof import("three")} THREE
 * @param {{width: number, height: number}} size
 * @param {readonly string[]} house - The house map (game.js HOUSES[].rows).
 */
export function createHorrorView(THREE, { width, height }, house) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.Fog(0x000000, 2, 16);

  const camera = new THREE.PerspectiveCamera(70, width / height, 0.05, 40);
  scene.add(camera);

  // The flashlight, held a little right of and below the eyes.
  const flashlight = new THREE.SpotLight(0xfff1d6, 40, 22, 0.5, 0.55, 1.6);
  flashlight.position.set(0.25, -0.25, 0);
  flashlight.castShadow = true;
  flashlight.shadow.mapSize.set(512, 512);
  flashlight.shadow.camera.near = 0.2;
  flashlight.shadow.camera.far = 22;
  camera.add(flashlight);
  flashlight.target.position.set(0, -0.2, -1);
  camera.add(flashlight.target);

  // Floor and ceiling.
  const rows = house.length;
  const cols = house[0].length;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(cols * CELL, rows * CELL),
    new THREE.MeshStandardMaterial({ color: 0x3b2f26, roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((cols * CELL) / 2, 0, (rows * CELL) / 2);
  floor.receiveShadow = true;
  scene.add(floor);
  const ceiling = floor.clone();
  ceiling.material = new THREE.MeshStandardMaterial({ color: 0x1d1a18, roughness: 1 });
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = WALL_HEIGHT;
  scene.add(ceiling);

  // Walls: one instanced mesh, so the whole house is a single draw call.
  const wallCells = [];
  house.forEach((row, r) => [...row].forEach((ch, c) => ch === "#" && wallCells.push({ c, r })));
  const walls = new THREE.InstancedMesh(
    new THREE.BoxGeometry(CELL, WALL_HEIGHT, CELL),
    new THREE.MeshStandardMaterial({ color: 0x6b6258, roughness: 0.9 }),
    wallCells.length,
  );
  const place = new THREE.Matrix4();
  wallCells.forEach(({ c, r }, i) => {
    place.makeTranslation((c + 0.5) * CELL, WALL_HEIGHT / 2, (r + 0.5) * CELL);
    walls.setMatrixAt(i, place);
  });
  walls.castShadow = true;
  walls.receiveShadow = true;
  scene.add(walls);

  // The door, hinged on one side so it can swing open.
  const hinge = new THREE.Group();
  const doorMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, WALL_HEIGHT * 0.85, CELL * 0.9),
    new THREE.MeshStandardMaterial({ color: 0x5a1f14, roughness: 0.7 }),
  );
  doorMesh.position.set(0, (WALL_HEIGHT * 0.85) / 2, CELL * 0.45);
  doorMesh.castShadow = true;
  hinge.add(doorMesh);
  scene.add(hinge);

  const keyMaterial = new THREE.MeshStandardMaterial({
    color: 0xd9a826,
    metalness: 0.7,
    roughness: 0.3,
    emissive: 0x3a2a00,
  });
  const keyMeshes = [];

  const monster = buildMonster(THREE);
  scene.add(monster.group);

  function syncKeys(keys) {
    while (keyMeshes.length < keys.length) {
      const key = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 6, 12), keyMaterial);
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.26), keyMaterial);
      shaft.position.z = 0.22;
      key.add(ring, shaft);
      scene.add(key);
      keyMeshes.push(key);
    }
    keys.forEach((k, i) => {
      keyMeshes[i].visible = !k.taken;
      keyMeshes[i].position.set(k.x, 0.9, k.y);
    });
  }

  return {
    canvas: renderer.domElement,

    /** @param {object} s - The game's state. @param {number} clock - ms */
    render(s, clock) {
      const p = s.player;
      const moving = s.phase === "playing";
      const bob = moving ? Math.sin(clock / 140) * 0.03 : 0;
      camera.position.set(p.x, EYE_HEIGHT + bob, p.y);
      camera.lookAt(p.x + Math.cos(p.angle), EYE_HEIGHT + bob, p.y + Math.sin(p.angle));

      syncKeys(s.keys);
      for (const key of keyMeshes) key.rotation.y = clock / 600;

      // Door on the house's east edge: the hinge at its north corner, swinging outward.
      hinge.position.set(s.door.x - CELL / 2, 0, s.door.y - CELL / 2);
      const open = s.door.open ? Math.PI / 2 : 0;
      hinge.rotation.y += (open - hinge.rotation.y) * 0.08;

      monster.update(s.monster, p, clock);
      renderer.render(scene, camera);
      return renderer.domElement;
    },

    dispose() {
      renderer.dispose();
    },
  };
}

/** A tall, thin, hunched thing: flat-shaded plain shapes, glowing eyes. */
function buildMonster(THREE) {
  const skin = new THREE.MeshStandardMaterial({
    color: 0x2b2a30,
    roughness: 0.8,
    flatShading: true,
  });
  const pale = new THREE.MeshStandardMaterial({
    color: 0xb9b2a6,
    roughness: 0.6,
    flatShading: true,
  });
  const glow = new THREE.MeshBasicMaterial({ color: 0xff2a1a, fog: false });

  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.55, 6), skin);
  body.position.y = 0.95;
  body.rotation.x = 0.12; // hunched forward
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.27, 0), pale);
  head.position.set(0, 1.95, 0.12);
  head.scale.set(0.9, 1.25, 0.9);
  const jaw = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 5), pale);
  jaw.position.set(0, 1.7, 0.2);
  jaw.rotation.x = Math.PI;
  const eyes = [-0.1, 0.1].map((x) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 4), glow);
    eye.position.set(x, 2.0, 0.34);
    return eye;
  });
  const arms = [-1, 1].map((side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.3, 1.6, 0.05);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.035, 1.3, 5), skin);
    arm.position.y = -0.65;
    const claw = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 4), pale);
    claw.position.y = -1.38;
    claw.rotation.x = Math.PI;
    shoulder.add(arm, claw);
    return shoulder;
  });
  group.add(body, head, jaw, ...eyes, ...arms);
  group.traverse((part) => {
    if (part.isMesh && part.material !== glow) part.castShadow = true;
  });

  return {
    group,
    update(m, player, clock) {
      const chasing = m.mode === "chase";
      group.position.set(m.x, Math.abs(Math.sin(clock / (chasing ? 110 : 220))) * 0.06, m.y);
      group.rotation.y = Math.atan2(player.x - m.x, player.y - m.y);
      const swing = Math.sin(clock / (chasing ? 120 : 260)) * (chasing ? 0.7 : 0.25);
      arms[0].rotation.x = -0.3 + swing;
      arms[1].rotation.x = -0.3 - swing;
      head.rotation.z = Math.sin(clock / 700) * 0.15;
    },
  };
}
