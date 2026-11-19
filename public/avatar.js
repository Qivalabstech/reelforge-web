// Blocky: the 3D host, rendered frame by frame into its own canvas.
import * as THREE from 'three';
import { GLTFLoader } from './lib/loaders/GLTFLoader.js';
import { CHARACTER_GLB, CHAIR_GLB } from './models.js';

const EXPR_MORPH = { neutral: null, happy: 'Joy', laugh: 'Fun', shocked: 'Surprised', angry: 'Angry', sad: 'Sorrow' };
const MORPHS = ['A', 'I', 'U', 'E', 'O', 'Blink', 'Joy', 'Angry', 'Sorrow', 'Fun', 'Surprised', 'LookLeft', 'LookRight', 'LookUp', 'LookDown'];

export async function createAvatar(W = 1080, H = 768) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#140b2c');
  const camera = new THREE.PerspectiveCamera(35, W / H, 0.05, 50);
  camera.position.set(0.12, 1.04, 1.75);
  camera.lookAt(0, 0.97, 0);

  scene.add(new THREE.HemisphereLight('#bfa8ff', '#1a0f30', 1.1));
  const key = new THREE.DirectionalLight('#ffffff', 2.2);
  key.position.set(1.2, 2.4, 2.2); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); scene.add(key);
  const pink = new THREE.PointLight('#ff4fa3', 6, 6); pink.position.set(-1.4, 1.8, 0.6); scene.add(pink);
  const cyan = new THREE.PointLight('#33e1ff', 5, 6); cyan.position.set(1.5, 1.4, -0.4); scene.add(cyan);

  const mat = (c, e = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: .8, emissive: e ? c : '#000', emissiveIntensity: e });
  const addBox = (p, s, pos, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(...s), m); b.position.set(...pos); b.receiveShadow = true; p.add(b); return b; };
  const room = new THREE.Group(); scene.add(room);
  addBox(room, [8, 0.02, 6], [0, -0.01, 0], mat('#140c28'));
  addBox(room, [8, 4, 0.05], [0, 2, -1.3], mat('#241448'));
  addBox(room, [8, 0.04, 0.04], [0, 1.95, -1.26], mat('#ff4fa3', 2.5));
  addBox(room, [0.9, 0.03, 0.3], [1.05, 1.0, -1.12], mat('#3a2a6a'));
  addBox(room, [0.16, 0.42, 0.24], [0.85, 1.225, -1.12], mat('#101016'));
  addBox(room, [0.012, 0.34, 0.012], [0.85, 1.225, -0.995], mat('#33e1ff', 3));
  ['#e04848', '#3aa0ff', '#f5b83d'].forEach((c, i) => addBox(room, [0.04, 0.22, 0.17], [1.12 + i * 0.05, 1.125, -1.12], mat(c)));
  const pc = document.createElement('canvas'); pc.width = 256; pc.height = 360;
  const g = pc.getContext('2d');
  g.fillStyle = '#121a3d'; g.fillRect(0, 0, 256, 360); g.fillStyle = '#1d2160'; g.fillRect(0, 0, 256, 150);
  g.fillStyle = '#ffd9a8'; g.beginPath(); g.arc(196, 54, 26, 0, Math.PI * 2); g.fill();
  [[4,160,34],[38,120,40],[78,175,30],[108,95,46],[154,140,36],[190,110,62]].forEach(([x,y,w],i)=>{ g.fillStyle=i%2?'#0a0f2a':'#070b1f'; g.fillRect(x,y,w,260-y); g.fillStyle=i%2?'#33e1ff':'#ffd23f'; for(let k=0;k<4;k++) g.fillRect(x+8+(k%2)*14,y+14+k*20,6,6); });
  g.fillStyle = '#17151f'; g.fillRect(0, 260, 256, 46);
  g.fillStyle = '#ff3d7f'; g.beginPath(); g.moveTo(50,286); g.lineTo(72,268); g.lineTo(136,262); g.lineTo(162,276); g.lineTo(196,280); g.lineTo(198,292); g.lineTo(50,294); g.fill();
  g.fillStyle = '#ff4fa3'; g.font = '900 30px Arial Black, Arial, sans-serif'; g.textAlign = 'center'; g.fillText('NEON NIGHTS', 128, 342);
  const tex = new THREE.CanvasTexture(pc); tex.colorSpace = THREE.SRGBColorSpace;
  addBox(room, [0.74, 1.02, 0.02], [-0.95, 1.35, -1.27], mat('#0b0b14'));
  const poster = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.96), new THREE.MeshStandardMaterial({ map: tex, roughness: .9, emissive: '#fff', emissiveMap: tex, emissiveIntensity: .35 }));
  poster.position.set(-0.95, 1.35, -1.255); room.add(poster);

  const loader = new GLTFLoader();
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;
  const load = (s) => new Promise((res, rej) => loader.parse(b64(s), '', res, rej));
  const bones = {}, faces = [], base = {};
  const [chr, chair] = await Promise.all([load(CHARACTER_GLB), load(CHAIR_GLB)]);
  chair.scene.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  scene.add(chair.scene); scene.add(chr.scene);
  chr.scene.traverse(o => { if (o.isBone) bones[o.name] = o; if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; if (o.morphTargetDictionary) faces.push(o); } });

  const aim = (n, dir, rest) => {
    const b = bones[n]; b.parent.updateWorldMatrix(true, false);
    const pq = b.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    b.quaternion.setFromUnitVectors(rest, dir.clone().normalize().applyQuaternion(pq)); b.updateMatrixWorld(true);
  };
  const X = new THREE.Vector3(1, 0, 0), nX = new THREE.Vector3(-1, 0, 0), nY = new THREE.Vector3(0, -1, 0);
  bones.hips.position.set(0, 0.47, 0.03); bones.hips.updateMatrixWorld(true);
  aim('leftUpperLeg', new THREE.Vector3(0.08, -0.04, 1), nY); aim('rightUpperLeg', new THREE.Vector3(-0.08, -0.04, 1), nY);
  aim('leftLowerLeg', new THREE.Vector3(0.02, -1, 0.08), nY); aim('rightLowerLeg', new THREE.Vector3(-0.02, -1, 0.08), nY);
  aim('leftUpperArm', new THREE.Vector3(0.3, -0.85, 0.45), X); aim('rightUpperArm', new THREE.Vector3(-0.3, -0.85, 0.45), nX);
  aim('leftLowerArm', new THREE.Vector3(-0.6, 0.15, 0.8), X); aim('rightLowerArm', new THREE.Vector3(0.6, 0.15, 0.8), nX);
  for (const n in bones) base[n] = bones[n].quaternion.clone();
  const lh = bones.leftHand.getWorldPosition(new THREE.Vector3()), rh = bones.rightHand.getWorldPosition(new THREE.Vector3());
  const pad = new THREE.Group();
  addBox(pad, [0.2, 0.05, 0.09], [0, 0, 0], mat('#2b2b36'));
  addBox(pad, [0.05, 0.05, 0.12], [0.08, 0, -0.02], mat('#22222b')); addBox(pad, [0.05, 0.05, 0.12], [-0.08, 0, -0.02], mat('#22222b'));
  [['#33e1ff', .05, .03], ['#ff4fa3', .065, .015], ['#ffd23f', .035, .015], ['#6cd38a', .05, 0]].forEach(([c, x, z]) => addBox(pad, [.012, .012, .012], [x, .03, z], mat(c, 1.5)));
  pad.position.copy(lh).add(rh).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.02, 0.06));
  scene.add(pad); bones.chest.attach(pad);

  const setMorph = (n, v) => { for (const m of faces) { const i = m.morphTargetDictionary[n]; if (i !== undefined) m.morphTargetInfluences[i] = v; } };
  const eu = new THREE.Euler(), q = new THREE.Quaternion();
  const off = (n, x, y, z) => { bones[n].quaternion.copy(base[n]).multiply(q.setFromEuler(eu.set(x, y, z))); };
  const clamp01 = (x) => Math.max(0, Math.min(1, x));

  let TL = null, blinks = [];
  function setup(tl) {
    TL = tl; blinks = [];
    let s = 12345; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let t = 1.2; t < tl.duration + 5; t += 2.2 + rnd() * 2.6) blinks.push(t);
  }

  function renderAt(t) {
    const w = Object.fromEntries(MORPHS.map(m => [m, 0]));
    let lean = 0, hx = Math.sin(t * 0.9) * 0.04, hy = Math.sin(t * 0.6) * 0.07, hz = Math.sin(t * 0.5) * 0.03, lookUp = 0;
    for (const sg of TL.segments) {
      const e = clamp01((t - sg.start) / 0.15) * clamp01((sg.end - t) / 0.15);
      if (e <= 0) continue;
      const m = EXPR_MORPH[sg.expr]; if (m) w[m] += e * (sg.talk ? 0.45 : 1);
      const k = t - sg.start;
      if (sg.expr === 'laugh') { hx += e * (Math.sin(t * 18) * 0.08 - 0.12); lean += e * (-0.06 + Math.sin(t * 18) * 0.03); }
      if (sg.expr === 'shocked') { const r = clamp01(k * 6); lean += e * -0.14 * r; hx += e * -0.18 * r; hy += e * Math.sin(t * 25) * 0.02 * Math.max(0, 1 - k); }
      if (sg.expr === 'angry') { lean += e * 0.12; hx += e * 0.08; hy += e * Math.sin(t * 10) * 0.12; }
      if (sg.expr === 'sad') { lean += e * 0.05; hx += e * 0.25; }
      if (sg.expr === 'happy') { hz += e * Math.sin(t * 3) * 0.1; }
      if (sg.talk) { hx += e * Math.sin(t * 7.3) * 0.03; hy += e * Math.sin(t * 4.1) * 0.05; }
      if (sg.look === 'up') lookUp += e;
    }
    hx -= 0.13 * lookUp;
    w.LookUp = Math.max(w.LookUp, 0.7 * lookUp);
    const br = Math.sin(t * 2.2) * 0.02;
    off('spine', lean * 0.5 + br, 0, 0); off('chest', lean * 0.5 + br, 0, 0);
    off('neck', hx * 0.4, hy * 0.4, hz * 0.4); off('head', hx * 0.6, hy * 0.6, hz * 0.6);
    for (const b of blinks) { const d = t - b; if (d >= 0 && d < 0.16) w.Blink = Math.sin(d / 0.16 * Math.PI); }
    if (w.Fun > 0.5 || w.Joy > 0.5) w.Blink = 0;
    const v = TL.visemes[Math.round(t * TL.fps)];
    if (v) { w.A = v[0]; w.I = v[1]; w.U = v[2]; w.E = v[3]; w.O = v[4]; }
    for (const m of MORPHS) setMorph(m, Math.min(1, w[m]));
    renderer.render(scene, camera);
    return renderer.domElement;
  }

  return { canvas: renderer.domElement, setup, renderAt };
}
