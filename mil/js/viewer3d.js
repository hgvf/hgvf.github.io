// viewer3d.js — 程序化武器 3D 檢視器（Three.js）。
// 依 model_3d.shape 參數以基本幾何組出「可辨識輪廓」的近似模型（fidelity C，識別用途）。
// 支援：旋轉/縮放/平移、零件標註熱點、爆炸視圖、高亮。不載入外部 GLB。
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const COL = {
  allied: 0x6fa8c7, brass: 0xc9a227, panel: 0x161c24, rule: 0x2c3743, paper: 0xe6e0d2,
};
const clamp01 = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

export class WeaponViewer {
  constructor(container) {
    this.container = container;
    this.selectCbs = [];
    this.exploded = false;
    this.markers = [];
    this._targets = new Map();      // object -> {base:Vec3, explode:Vec3}
    this._init();
  }

  _init() {
    const w = this.container.clientWidth || 600, h = this.container.clientHeight || 420;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0e12);
    this.scene.fog = new THREE.Fog(0x0b0e12, 14, 34);

    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 200);
    this.camera.position.set(6, 3.4, 8);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 30;

    // 燈光
    this.scene.add(new THREE.AmbientLight(0x8494a0, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(5, 8, 6); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x6fa8c7, 0.7); rim.position.set(-6, 2, -4); this.scene.add(rim);
    const fill = new THREE.DirectionalLight(0xc9a227, 0.35); fill.position.set(0, -4, 3); this.scene.add(fill);

    // 網格底盤（海圖刻度感）
    const grid = new THREE.GridHelper(24, 24, COL.rule, 0x1a2530);
    grid.position.y = -1.6; this.scene.add(grid);

    this.model = new THREE.Group();
    this.scene.add(this.model);

    // 互動
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.renderer.domElement.addEventListener("pointerdown", e => this._onPointer(e));
    this.renderer.domElement.style.cursor = "grab";
    this.renderer.domElement.addEventListener("pointermove", e => this._hover(e));

    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this.container);

    this._loop = this._loop.bind(this);
    this.renderer.setAnimationLoop(this._loop);
  }

  onSelect(cb) { this.selectCbs.push(cb); }

  // 依 shape 參數建模。s 單位為公尺，內部再統一縮放到視野。
  setModel(model3d) {
    // 清空
    this.model.clear(); this.markers = []; this._targets.clear();
    const s = (model3d && model3d.shape) || { bodyLen: 4, bodyDia: 0.35, color: "#cdd2d8", nose: "ogive", tailFins: { span: 0.5, chord: 0.4, count: 4 } };
    const R = (s.bodyDia || 0.35) / 2;
    const L = s.bodyLen || 4;
    const bodyColor = new THREE.Color(s.color || "#cdd2d8");
    const mat = new THREE.MeshStandardMaterial({ color: bodyColor, metalness: 0.55, roughness: 0.45, flatShading: !!s.faceted });
    const darkMat = new THREE.MeshStandardMaterial({ color: bodyColor.clone().multiplyScalar(0.7), metalness: 0.6, roughness: 0.5 });
    const finMat = new THREE.MeshStandardMaterial({ color: bodyColor.clone().multiplyScalar(0.85), metalness: 0.4, roughness: 0.55, side: THREE.DoubleSide });

    // 座標：沿 X 軸擺放，機鼻在 +X。0 = 機鼻尖，L = 尾端。
    const noseLen = R * (s.nose === "cone" ? 3.2 : s.nose === "chisel" ? 2.2 : s.nose === "blunt" ? 0.9 : 2.6);
    const bodyLen = Math.max(0.1, L - noseLen);

    // 本體
    const bodyGeo = new THREE.CylinderGeometry(R, R, bodyLen, s.faceted ? 8 : 28);
    bodyGeo.rotateZ(Math.PI / 2);
    const body = new THREE.Mesh(bodyGeo, mat);
    body.position.x = L - noseLen - bodyLen / 2;   // 尾端在 x=0 側
    this.model.add(body);

    // 機鼻
    let noseGeo;
    if (s.nose === "blunt") { noseGeo = new THREE.SphereGeometry(R, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2); noseGeo.rotateZ(-Math.PI / 2); }
    else { noseGeo = new THREE.ConeGeometry(R, noseLen, s.faceted ? 8 : 26); noseGeo.rotateZ(-Math.PI / 2); }
    const nose = new THREE.Mesh(noseGeo, mat);
    nose.position.x = L - noseLen / 2;
    this.model.add(nose);

    // 尾焰噴嘴
    const nozGeo = new THREE.CylinderGeometry(R * 0.75, R * 0.55, R * 0.6, 20); nozGeo.rotateZ(Math.PI / 2);
    const noz = new THREE.Mesh(nozGeo, darkMat); noz.position.x = -R * 0.3; this.model.add(noz);

    const axAt = f => f * L;   // 0..1 (nose→tail measured from nose) → x 位置（x 由尾0到鼻L）
    const xFromAxial = f => L - f * L;

    // 彈翼（中段）
    if (s.wings) {
      this._ring(s.wings.count || 4, s.wings, xFromAxial(clamp01(s.wings.axial ?? 0.5, 0.2, 0.7)), R, finMat, s.wings.sweep || 0.25, "wing");
    }
    // 尾翼（貼近尾端但仍坐落於彈體上）
    if (s.tailFins) {
      const tailChord = s.tailFins.chord || R * 2;
      this._ring(s.tailFins.count || 4, s.tailFins, Math.max(tailChord * 0.6, R * 1.2), R, finMat, 0.15, "tail");
      if (s.tailFins.strakes) this._ring(s.tailFins.count || 4, { span: (s.tailFins.span || R * 2) * 0.6, chord: (s.tailFins.chord || R * 2) * 1.6 }, xFromAxial(0.62), R, finMat, 0.05, "strake");
    }
    // 前翼 / 控制面
    if (s.canards) this._ring(4, s.canards, xFromAxial(clamp01(s.canards.axial ?? 0.2, 0.08, 0.35)), R, finMat, 0.1, "canard");

    // 衝壓/渦扇進氣道
    if (s.intake) this._intakes(s.intake, xFromAxial(0.55), R, L, darkMat);

    // 串列助推器（爆炸視圖分離）
    if (s.booster) {
      const bR = (s.booster.dia || s.bodyDia) / 2, bL = s.booster.len || 1;
      const bGeo = new THREE.CylinderGeometry(bR, bR * 0.9, bL, 22); bGeo.rotateZ(Math.PI / 2);
      const boost = new THREE.Mesh(bGeo, darkMat);
      boost.position.x = -bL / 2 - 0.02;
      this.model.add(boost);
      this._targets.set(boost, { base: boost.position.clone(), explode: boost.position.clone().add(new THREE.Vector3(-bL * 1.1, 0, 0)) });
      // 助推尾翼（在助推段本體上）
      this._ring(4, { span: bR * 2.2, chord: bL * 0.3 }, -bL * 0.35, bR, finMat, 0.1, "bfin", boost);
    }

    // 標註熱點
    (model3d?.annotations || []).forEach(a => this._addMarker(a, R, L));

    // 縮放置中：讓最長邊 ~ 8 單位
    const box = new THREE.Box3().setFromObject(this.model);
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    const scale = 8 / Math.max(size.x, size.y, size.z, 0.001);
    this.model.scale.setScalar(scale);
    this.model.position.sub(center.multiplyScalar(scale));
    this._modelScale = scale;

    this.setExploded(false);
  }

  // 全部尺寸以「本體半徑 R」為基準並夾限，任何輸入都能得到可辨識、不跑版的翼面。
  // fin.span 視為全展長（tip-to-tip 概念）→ 單片徑向長 reach = clamp(span/2, 0.5R, maxReach)。
  _ring(count, fin, x, R, mat, sweep, kind, parent) {
    const cl = (v, a, b) => Math.max(a, Math.min(b, v));
    const maxReach = kind === "wing" ? R * 3.4 : kind === "canard" ? R * 1.6 : R * 2.6;
    // fin.span = 全展長(tip-to-tip)；單片刀面長 = span/2 - R（從本體表面到翼尖），夾限。
    const reach = cl((fin.span || R * 2) * 0.5 - R, R * 0.4, maxReach);
    const chord = cl(fin.chord || R * 2, R * 0.5, R * 6);             // 弦長（沿彈體）
    const thick = Math.max(0.012, R * 0.06);
    const geo = new THREE.BoxGeometry(chord, reach, thick);
    // 後掠：徑向越外，後緣越往 -X（真正的平行四邊形剪切，非 no-op）
    const pos = geo.attributes.position, yMin = -reach / 2;
    for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) - (pos.getY(i) - yMin) * sweep);
    geo.computeVertexNormals();
    const host = parent || this.model;
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + (count === 4 ? Math.PI / 4 : 0);
      const fmesh = new THREE.Mesh(geo, mat);
      fmesh.position.set(x, R + reach / 2, 0);   // 內緣貼合本體表面
      const pivot = new THREE.Group();
      pivot.add(fmesh);
      pivot.rotation.x = ang;                          // 繞彈體軸(X)環狀分佈
      host.add(pivot);
    }
  }

  _intakes(kind, x, R, L, mat) {
    const len = Math.min(L * 0.2, R * 5);              // 進氣道長度夾限，避免變成大平板
    const mk = (y, z) => {
      const g = new THREE.BoxGeometry(len, R * 0.7, R * 0.8);
      const m = new THREE.Mesh(g, mat);
      m.position.set(x, y, z);
      this.model.add(m);
    };
    if (kind === "belly") mk(-R * 1.05, 0);
    else if (kind === "dorsal") mk(R * 1.05, 0);
    else if (kind === "side2") { mk(0, R * 1.05); mk(0, -R * 1.05); }
    else if (kind === "side") mk(0, R * 1.05);
    else if (kind === "nose") {
      const g = new THREE.TorusGeometry(R * 0.55, R * 0.18, 12, 24);
      const m = new THREE.Mesh(g, mat); m.position.x = L - R * 0.3; m.rotation.y = Math.PI / 2; this.model.add(m);
    }
  }

  _addMarker(a, R, L) {
    const f = a.axial ?? 0.5;
    const x = L - f * L;
    const off = R * 1.7 + 0.12;
    let y = 0, z = 0;
    switch (a.radial) {
      case "nose": y = R * 0.8; z = 0; break;
      case "dorsal": y = off; break;
      case "belly": y = -off; break;
      case "side": z = off; break;
      case "tail": y = off * 0.7; break;
      default: y = off;
    }
    const geo = new THREE.SphereGeometry(R * 0.55 + 0.06, 16, 16);
    const mat = new THREE.MeshBasicMaterial({ color: COL.brass });
    const dot = new THREE.Mesh(geo, mat);
    dot.position.set(x, y, z);
    dot.userData = { anno: a, base: dot.material.color.getHex() };
    // 引線
    const lineMat = new THREE.LineBasicMaterial({ color: COL.brass, transparent: true, opacity: 0.5 });
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, y * 0.3, z * 0.3), new THREE.Vector3(x, y, z)]);
    this.model.add(new THREE.Line(lg, lineMat));
    this.model.add(dot);
    this.markers.push(dot);
  }

  _onPointer(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.markers, false);
    if (hits.length) {
      const a = hits[0].object.userData.anno;
      this.highlight(a.id);
      this.selectCbs.forEach(cb => cb(a));
    }
  }
  _hover(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.markers, false).length > 0;
    this.renderer.domElement.style.cursor = hit ? "pointer" : "grab";
  }

  highlight(id) {
    this.markers.forEach(m => {
      const on = m.userData.anno.id === id;
      m.material.color.setHex(on ? 0xffffff : m.userData.base);
      m.scale.setScalar(on ? 1.6 : 1);
    });
  }

  setExploded(on) {
    this.exploded = on;
    this._targets.forEach((t, obj) => {
      if (t.base && t.explode && t.base.isVector3) obj.position.copy(on ? t.explode : t.base);
    });
  }
  toggleExploded() { this.setExploded(!this.exploded); }
  resetView() { this.camera.position.set(6, 3.4, 8); this.controls.target.set(0, 0, 0); this.controls.update(); }

  _resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }
  _loop() {
    this.model.rotation.y += 0.0016;   // 緩慢自轉
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.renderer.setAnimationLoop(null);
    this._ro.disconnect();
    this.renderer.dispose();
    this.container.innerHTML = "";
  }
}
