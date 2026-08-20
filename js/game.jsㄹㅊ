/* =========================================================
   AO-ONI: BUNKER  —  Three.js 브라우저 프로토타입 (GitHub Pages용)
   플레이어 = 아오오니. 벙커에 숨은 생존자들을 모두 잡으면 승리.
   3인칭(어깨 너머 추적) 카메라.

   ⚠ 로컬에서 테스트할 때는 index.html을 더블클릭하지 말고
      반드시 로컬 서버로 열어야 합니다 (fetch가 file://에서 막힘).
      예) VSCode의 "Live Server" 확장, 또는:
          python3 -m http.server 8000
      GitHub Pages에 올리면 그대로 정상 동작합니다.
   ========================================================= */

(() => {
  const loadingEl = document.getElementById('loading');
  const loadingBar = document.getElementById('loadingBar');
  const loadingTxt = document.getElementById('loadingTxt');
  const errorBox = document.getElementById('errorBox');

  function setLoading(pct, txt) {
    loadingBar.style.width = pct + '%';
    if (txt) loadingTxt.textContent = txt;
  }
  function fatalError(context, err) {
    console.error(context, err);
    errorBox.style.display = 'block';
    errorBox.textContent = `[오류: ${context}]\n${err && err.message ? err.message : err}\n\n` +
      `콘솔(F12)에서 자세한 내용을 확인하세요.\n` +
      `주로 이 파일을 file://로 직접 열었을 때 발생합니다. 로컬 서버(python3 -m http.server)나 GitHub Pages로 열어보세요.`;
  }

  // ---------- 기본 Three.js 셋업 ----------
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020203);
  // 안개 밀도/원거리 클리핑은 실제 맵 크기(levelBounds)를 계산한 뒤 boot()에서 다시 조정한다.
  scene.fog = new THREE.FogExp2(0x000000, 0.045);

  const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 500);
  camera.position.set(0, 1.6, 3.4);
  scene.add(camera);

  // 3인칭이므로 조명은 카메라가 아니라 아오오니 캐릭터(눈 위치)에 붙인다.
  const ambient = new THREE.AmbientLight(0x141420, 0.75);
  scene.add(ambient);
  const hemi = new THREE.HemisphereLight(0x33334a, 0x040406, 0.65);
  scene.add(hemi);
  const fill = new THREE.DirectionalLight(0x8899ff, 0.25);
  fill.position.set(3, 6, 2);
  scene.add(fill);

  function resize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  }
  addEventListener('resize', resize);
  resize();

  // ---------- 오디오 (전부 합성음) ----------
  let actx;
  function audio() { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); return actx; }
  function beep(freq, dur, type, gain, when = 0) {
    const ctx = audio();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.value = gain;
    o.connect(g).connect(ctx.destination);
    const t = ctx.currentTime + when;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.start(t); o.stop(t + dur);
  }
  function scream() { for (let i = 0; i < 6; i++) beep(700 + Math.random() * 500, 0.12, 'sawtooth', 0.15, i * 0.03); }
  function growl() { beep(70, 0.5, 'sawtooth', 0.2); beep(50, 0.7, 'triangle', 0.15, 0.05); }
  function heartbeat() { beep(60, 0.12, 'sine', 0.25); beep(55, 0.12, 'sine', 0.2, 0.18); }
  function footstepClick() { beep(120 + Math.random() * 40, 0.05, 'square', 0.05); }
  function startAmbientDrone() {
    const ctx = audio();
    const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 42;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 45.2;
    const g = ctx.createGain(); g.gain.value = 0.05;
    o1.connect(g); o2.connect(g); g.connect(ctx.destination);
    o1.start(); o2.start();
  }
  let heartbeatTimer = null;
  function setHeartbeatRate(intervalMs) {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (intervalMs > 0) heartbeatTimer = setInterval(heartbeat, intervalMs);
  }

  // ---------- 로더 ----------
  const fbxLoader = new THREE.FBXLoader();
  const texLoader = new THREE.TextureLoader();

  function loadFBX(url) {
    return new Promise((resolve, reject) => fbxLoader.load(url, resolve, undefined, reject));
  }
  // tileable=true: 벽/바닥/천장처럼 UV를 반복해서 늘어 붙이는 표면용.
  // tileable=false: 캐릭터 얼굴/몸처럼 UV 전체에 한 장이 딱 맞게 매핑된 텍스처용.
  // 예전 코드는 이 둘을 구분하지 않고 전부 1.5배 반복(RepeatWrapping)을 걸어서,
  // 아오오니 텍스처가 몸 위에서 뒤틀리고 이어붙는 것처럼(얼룩덜룩하게) 보였다.
  function loadTexture(url, srgb, tileable = true) {
    return new Promise((resolve, reject) => {
      texLoader.load(url, tex => {
        if (tileable) {
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.repeat.set(1.5, 1.5);
        } else {
          tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        }
        if (srgb) tex.encoding = THREE.sRGBEncoding;
        resolve(tex);
      }, undefined, reject);
    });
  }

  const ASSET = {
    bunker: 'assets/models/bunker.fbx',
    aooni: 'assets/models/ao_oni.fbx',
    animWalk: 'assets/models/anim_walk.fbx',
    animRun: 'assets/models/anim_run.fbx',
    animJump: 'assets/models/anim_jump.fbx',
    aooniTex: 'assets/textures/ao_oni_diffuse.png',
    wallAlbedo: 'assets/textures/wall_albedo.png',
    wallNormal: 'assets/textures/wall_normal.png',
    floorAlbedo: 'assets/textures/floor_albedo.png',
    floorNormal: 'assets/textures/floor_normal.png',
    ceilAlbedo: 'assets/textures/ceiling_albedo.png',
    ceilNormal: 'assets/textures/ceiling_normal.png',
  };

  const wallBoxes = [];
  let levelBounds = new THREE.Box3();
  let floorY = 0;
  let npcSpawnPoints = [];
  let bunkerObj = null;

  // 벽/바닥/천장 노멀이 뒤집혀 있어도(자주 있는 FBX 내보내기 실수) 안쪽에서
  // 검게 사라지지 않도록 DoubleSide로 렌더링한다.
  function materialFor(name, tex) {
    const n = name.toLowerCase();
    if (n.includes('wall')) return new THREE.MeshStandardMaterial({ map: tex.wallAlbedo, normalMap: tex.wallNormal, roughness: 0.95, metalness: 0.05, side: THREE.DoubleSide });
    if (n.includes('floor')) return new THREE.MeshStandardMaterial({ map: tex.floorAlbedo, normalMap: tex.floorNormal, roughness: 0.9, metalness: 0.05, side: THREE.DoubleSide });
    if (n.includes('ceil')) return new THREE.MeshStandardMaterial({ map: tex.ceilAlbedo, normalMap: tex.ceilNormal, roughness: 0.95, metalness: 0.05, side: THREE.DoubleSide });
    return new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 1, side: THREE.DoubleSide });
  }

  // ---------- 메뉴 미리보기 씬 ----------
  const previewCanvas = document.getElementById('preview');
  const previewRenderer = new THREE.WebGLRenderer({ canvas: previewCanvas, antialias: true, alpha: true });
  previewRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const previewScene = new THREE.Scene();
  const previewCam = new THREE.PerspectiveCamera(35, previewCanvas.width / previewCanvas.height, 0.05, 50);
  previewScene.add(new THREE.PointLight(0xff3333, 3, 12).translateX(1).translateY(1.2).translateZ(2));
  previewScene.add(new THREE.AmbientLight(0x333344, 1.2));
  let previewObj = null, previewMixer = null, previewIdleAction = null;
  function renderPreview() {
    requestAnimationFrame(renderPreview);
    if (previewObj) previewObj.rotation.y += 0.01;
    if (previewMixer) previewMixer.update(0.016);
    previewRenderer.render(previewScene, previewCam);
  }
  renderPreview();

  // ---------- 플레이어(아오오니) 캐릭터 애니메이션 상태 ----------
  let charAnims = { idle: null, walk: null, run: null, jump: null };
  let charMixer = null;
  let currentAction = null;
  function playAction(name, fade = 0.25) {
    const clip = charAnims[name];
    if (!clip || !charMixer) return;
    if (currentAction === clip.action) return;
    const next = clip.action;
    next.reset().fadeIn(fade).play();
    if (currentAction) currentAction.fadeOut(fade);
    currentAction = next;
  }

  // ---------- 3인칭 플레이어 리그 + 카메라 ----------
  // playerRig = 실제 위치(발밑 기준). 카메라는 매 프레임 playerRig를 따라가며
  // 회전은 마우스(PointerLockControls)가 그대로 담당한다(오버 더 숄더 방식).
  const playerRig = new THREE.Group();
  scene.add(playerRig);
  let playerModel = null;
  let eyeLight = null;
  const FOLLOW_DIST = 3.2;
  const FOLLOW_LIFT = 0.25;   // 카메라가 머리 위로 붕 뜨지 않도록 살짝만 들어올림
  const LOOK_HEIGHT = 1.5;    // 캐릭터 눈높이 근처를 기준점으로 삼음
  const camRay = new THREE.Raycaster();

  const controls = new THREE.PointerLockControls(camera, document.body);
  const moveState = { f: false, b: false, l: false, r: false, sprint: false, jump: false };
  document.addEventListener('keydown', e => {
    if (e.code === 'KeyW') moveState.f = true;
    if (e.code === 'KeyS') moveState.b = true;
    if (e.code === 'KeyA') moveState.l = true;
    if (e.code === 'KeyD') moveState.r = true;
    if (e.code === 'ShiftLeft') moveState.sprint = true;
    if (e.code === 'Space') triggerJump();
  });
  document.addEventListener('keyup', e => {
    if (e.code === 'KeyW') moveState.f = false;
    if (e.code === 'KeyS') moveState.b = false;
    if (e.code === 'KeyA') moveState.l = false;
    if (e.code === 'KeyD') moveState.r = false;
    if (e.code === 'ShiftLeft') moveState.sprint = false;
  });
  let jumping = false;
  function triggerJump() {
    if (jumping || !gameActive) return;
    jumping = true;
    playAction('jump', 0.1);
    setTimeout(() => { jumping = false; }, 700);
  }

  const PLAYER_RADIUS = 0.35;
  function tryMove(dx, dz) {
    const pos = playerRig.position;
    const nx = pos.x + dx, nz = pos.z + dz;
    let blockedX = false, blockedZ = false;
    const testBox = (x, z) => {
      const b = new THREE.Box3(
        new THREE.Vector3(x - PLAYER_RADIUS, pos.y, z - PLAYER_RADIUS),
        new THREE.Vector3(x + PLAYER_RADIUS, pos.y + 1.8, z + PLAYER_RADIUS)
      );
      for (const wb of wallBoxes) if (wb.intersectsBox(b)) return true;
      return false;
    };
    if (testBox(nx, pos.z)) blockedX = true;
    if (testBox(pos.x, nz)) blockedZ = true;
    pos.x = blockedX ? pos.x : nx;
    pos.z = blockedZ ? pos.z : nz;
  }

  // ---------- NPC (생존자) — CylinderGeometry 기반 캡슐 형태 (CapsuleGeometry는 구버전 three.js에 없음) ----------
  function makeCapsuleMesh(mat) {
    const g = new THREE.Group();
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.9, 10), mat);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), mat);
    const bot = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), mat);
    top.position.y = 0.45; bot.position.y = -0.45;
    g.add(cyl, top, bot);
    return g;
  }

  class Survivor {
    constructor(pos) {
      const g = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd8c9a0, roughness: 0.8 });
      const body = makeCapsuleMesh(bodyMat);
      body.position.y = 0.85;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), bodyMat);
      head.position.y = 1.55;
      g.add(body, head);
      g.position.copy(pos);
      g.userData.caught = false;
      this.mesh = g;
      this.state = 'wander';
      this.target = pos.clone();
      this.speed = 1.1;
      this.pickNewWanderTarget();
      scene.add(g);
    }
    pickNewWanderTarget() {
      const p = npcSpawnPoints[Math.floor(Math.random() * npcSpawnPoints.length)];
      this.target = p.clone();
    }
    update(dt, playerPos) {
      if (this.mesh.userData.caught) return;
      const distToPlayer = this.mesh.position.distanceTo(playerPos);
      if (distToPlayer < 5.5) {
        this.state = 'flee'; this.speed = 2.6;
        const away = this.mesh.position.clone().sub(playerPos).normalize();
        this.target = this.mesh.position.clone().add(away.multiplyScalar(6));
      } else if (this.state === 'flee' && distToPlayer > 8) {
        this.state = 'wander'; this.speed = 1.1;
      }
      const toTarget = this.target.clone().sub(this.mesh.position);
      toTarget.y = 0;
      if (toTarget.length() < 0.4) {
        if (this.state === 'wander') this.pickNewWanderTarget();
      } else {
        toTarget.normalize();
        const step = toTarget.multiplyScalar(this.speed * dt);
        const nx = this.mesh.position.x + step.x, nz = this.mesh.position.z + step.z;
        const testBox = new THREE.Box3(
          new THREE.Vector3(nx - 0.3, floorY, nz - 0.3),
          new THREE.Vector3(nx + 0.3, floorY + 1.6, nz + 0.3)
        );
        let blocked = false;
        for (const wb of wallBoxes) if (wb.intersectsBox(testBox)) { blocked = true; break; }
        if (!blocked) { this.mesh.position.x = nx; this.mesh.position.z = nz; }
        else if (this.state === 'wander') this.pickNewWanderTarget();
        this.mesh.rotation.y = Math.atan2(step.x, step.z);
      }
      const bob = Math.sin(performance.now() * 0.01 * (this.state === 'flee' ? 2 : 1)) * 0.03;
      this.mesh.position.y = floorY + bob;
    }
    catch() { this.mesh.userData.caught = true; scene.remove(this.mesh); }
  }

  let survivors = [];
  const TOTAL_SURVIVORS = 5;
  const CATCH_RADIUS = 1.1;
  let caughtCount = 0;
  let gameTimeLeft = 150;
  let gameActive = false;

  function spawnSurvivors() {
    survivors = []; caughtCount = 0;
    const used = new Set();
    for (let i = 0; i < TOTAL_SURVIVORS; i++) {
      let idx;
      do { idx = Math.floor(Math.random() * npcSpawnPoints.length); } while (used.has(idx) && used.size < npcSpawnPoints.length);
      used.add(idx);
      survivors.push(new Survivor(npcSpawnPoints[idx]));
    }
  }

  // ---------- HUD ----------
  const hud = document.getElementById('hud');
  const targetsEl = document.getElementById('targets');
  const timerEl = document.getElementById('timer');
  const menuEl = document.getElementById('menu');
  const endEl = document.getElementById('end');
  const endTitle = document.getElementById('endTitle');
  const endDesc = document.getElementById('endDesc');

  function updateHud() {
    targetsEl.textContent = `남은 생존자: ${TOTAL_SURVIVORS - caughtCount} / ${TOTAL_SURVIVORS}`;
    const m = Math.floor(gameTimeLeft / 60), s = Math.floor(gameTimeLeft % 60);
    timerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
  }
  function endGame(win) {
    gameActive = false;
    controls.unlock();
    hud.style.display = 'none';
    endEl.style.display = 'flex';
    if (win) {
      endTitle.textContent = '사냥 완료'; endTitle.style.color = '#ff3b3b';
      endDesc.textContent = '벙커에 남은 온기는 이제 없다. 아오오니는 만족한 채 어둠 속으로 돌아간다.';
      scream();
    } else {
      endTitle.textContent = '탈출당함'; endTitle.style.color = '#9db4ff';
      endDesc.textContent = `시간이 다 되었다. ${TOTAL_SURVIVORS - caughtCount}명이 벙커를 빠져나갔다.`;
      growl();
    }
  }

  document.getElementById('startBtn').addEventListener('click', () => {
    menuEl.style.display = 'none';
    hud.style.display = 'block';
    controls.lock();
  });
  controls.addEventListener('lock', () => { if (!gameActive) startGame(); });
  controls.addEventListener('unlock', () => {
    if (gameActive) {
      hud.style.display = 'none';
      menuEl.style.display = 'flex';
      document.getElementById('startBtn').textContent = '계속하기';
    }
  });
  document.getElementById('restartBtn').addEventListener('click', () => location.reload());

  function startGame() {
    gameActive = true;
    gameTimeLeft = 150;
    spawnSurvivors();
    startAmbientDrone();
    setHeartbeatRate(1200);
    growl();
  }

  let last = performance.now();
  let stepTimer = 0;
  const flatDir = new THREE.Vector3();
  const fullDir = new THREE.Vector3();
  function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    if (charMixer) charMixer.update(dt);

    // 마우스 시점(회전)은 PointerLockControls가 camera.quaternion에 직접 반영한다.
    camera.getWorldDirection(fullDir);
    flatDir.set(fullDir.x, 0, fullDir.z).normalize();

    if (gameActive && controls.isLocked) {
      const moving = moveState.f || moveState.b || moveState.l || moveState.r;
      const speedMul = moveState.sprint ? 4.2 : 2.4;
      const speed = speedMul * dt;
      let dx = 0, dz = 0;
      const rightDir = new THREE.Vector3(flatDir.z, 0, -flatDir.x);
      if (moveState.f) { dx += flatDir.x * speed; dz += flatDir.z * speed; }
      if (moveState.b) { dx -= flatDir.x * speed; dz -= flatDir.z * speed; }
      if (moveState.r) { dx += rightDir.x * speed; dz += rightDir.z * speed; }
      if (moveState.l) { dx -= rightDir.x * speed; dz -= rightDir.z * speed; }
      tryMove(dx, dz);

      if (!jumping) {
        if (moving && moveState.sprint) playAction('run');
        else if (moving) playAction('walk');
        else playAction('idle');
      }
      if (moving) {
        stepTimer -= dt;
        if (stepTimer <= 0) { footstepClick(); stepTimer = moveState.sprint ? 0.28 : 0.45; }
      }

      playerRig.position.x = THREE.MathUtils.clamp(playerRig.position.x, levelBounds.min.x + 0.2, levelBounds.max.x - 0.2);
      playerRig.position.z = THREE.MathUtils.clamp(playerRig.position.z, levelBounds.min.z + 0.2, levelBounds.max.z - 0.2);
      playerRig.position.y = floorY;
      if (moving) playerRig.rotation.y = Math.atan2(flatDir.x, flatDir.z);

      for (const s of survivors) {
        s.update(dt, playerRig.position);
        if (!s.mesh.userData.caught && s.mesh.position.distanceTo(playerRig.position) < CATCH_RADIUS) {
          s.catch(); caughtCount++; scream();
          if (caughtCount >= TOTAL_SURVIVORS) endGame(true);
        }
      }

      gameTimeLeft -= dt;
      if (gameTimeLeft <= 0) { gameTimeLeft = 0; endGame(false); }
      updateHud();
    }

    // ---------- 3인칭 카메라: playerRig를 따라가며 벽 뒤로 파고들지 않도록 레이캐스트로 거리 보정 ----------
    const anchor = new THREE.Vector3(playerRig.position.x, playerRig.position.y + LOOK_HEIGHT, playerRig.position.z);
    let camDist = FOLLOW_DIST;
    if (bunkerObj) {
      camRay.set(anchor, fullDir.clone().multiplyScalar(-1));
      camRay.far = FOLLOW_DIST + 0.3;
      camRay.near = 0.05;
      const hits = camRay.intersectObject(bunkerObj, true);
      if (hits.length) camDist = Math.max(0.5, hits[0].distance - 0.25);
    }
    const camX = anchor.x - fullDir.x * camDist;
    const camY = anchor.y - fullDir.y * camDist + FOLLOW_LIFT;
    const camZ = anchor.z - fullDir.z * camDist;
    camera.position.set(
      THREE.MathUtils.clamp(camX, levelBounds.min.x + 0.1, levelBounds.max.x - 0.1),
      camY,
      THREE.MathUtils.clamp(camZ, levelBounds.min.z + 0.1, levelBounds.max.z - 0.1)
    );

    renderer.render(scene, camera);
  }

  // ---------- 로딩 시퀀스 ----------
  async function boot() {
    try {
      setLoading(5, '텍스처를 불러오는 중...');
      const tex = {};
      // [키, srgb 색공간 여부, 반복(tile) 여부] — 캐릭터 텍스처(aooniTex)는 반복 금지.
      const texJobs = [
        ['aooniTex', true, false], ['wallAlbedo', true, true], ['wallNormal', false, true],
        ['floorAlbedo', true, true], ['floorNormal', false, true], ['ceilAlbedo', true, true], ['ceilNormal', false, true],
      ];
      for (let i = 0; i < texJobs.length; i++) {
        const [key, srgb, tileable] = texJobs[i];
        tex[key] = await loadTexture(ASSET[key], srgb, tileable);
        setLoading(5 + (i + 1) / texJobs.length * 25, `텍스처를 불러오는 중... (${key})`);
      }

      // ---- 아오오니 모델을 먼저 불러와 실제 크기를 측정한다 ----
      // (내보내기 단위 설정에 따라 FBX가 cm/inch 단위로 저장돼 수십~수백 배
      //  크게 들어오는 경우가 흔하다 → 미리보기가 "텍스처가 늘어난 살덩이"처럼
      //  거대하게 보이고, 게임 씬에서는 카메라가 거대한 지오메트리 안쪽/벽 속에
      //  파묻혀 화면이 새까맣게 나오는 원인이 된다. 캐릭터 키를 사람 크기로
      //  정규화하고, 같은 배율을 벙커에도 적용해 둘의 상대 크기를 맞춘다.)
      setLoading(45, '아오오니 모델을 불러오는 중...');
      const aooniObj = await loadFBX(ASSET.aooni);
      aooniObj.traverse(child => {
        if (child.isMesh) {
          child.material = new THREE.MeshStandardMaterial({ map: tex.aooniTex, roughness: 0.8, side: THREE.DoubleSide });
          child.castShadow = true;
        }
      });
      aooniObj.updateMatrixWorld(true);
      const rawBox = new THREE.Box3().setFromObject(aooniObj);
      const rawHeight = Math.max(rawBox.max.y - rawBox.min.y, 0.001);
      const SCALE = 1.8 / rawHeight; // 아오오니 키를 1.8m로 정규화
      aooniObj.scale.setScalar(SCALE);
      aooniObj.updateMatrixWorld(true);

      // 발이 y=0, 좌우/앞뒤 중심이 x=0,z=0에 오도록 재배치 (미리보기 회전 축과 3인칭 배치에 사용)
      const box = new THREE.Box3().setFromObject(aooniObj);
      const center = new THREE.Vector3(); box.getCenter(center);
      aooniObj.position.set(-center.x, -box.min.y, -center.z);
      aooniObj.updateMatrixWorld(true);
      const size = new THREE.Vector3(); box.getSize(size);

      setLoading(60, '벙커 지도를 불러오는 중...');
      bunkerObj = await loadFBX(ASSET.bunker);
      // ⚠ 캐릭터와 같은 배율(SCALE)을 그대로 재사용했더니, 벙커가 원래 이미
      //   정상 단위였을 경우 벙커만 훨씬 더 작아져(예: 1/100 크기) 버려서
      //   카메라가 먼 허공에 떠 있는 것처럼 되고 화면이 새까맣게 나왔다.
      //   → 벙커는 캐릭터와 별개로, 자기 자신의 원본 크기를 기준으로
      //   합리적인 벙커 규모(가로/세로 최대 45m)에 맞춰 독립적으로 정규화한다.
      bunkerObj.updateMatrixWorld(true);
      const bunkerRawBox = new THREE.Box3().setFromObject(bunkerObj);
      const bunkerRawSize = new THREE.Vector3(); bunkerRawBox.getSize(bunkerRawSize);
      const bunkerSpan = Math.max(bunkerRawSize.x, bunkerRawSize.z) || 1;
      const BUNKER_TARGET_SPAN = 45;
      const BUNKER_SCALE = BUNKER_TARGET_SPAN / bunkerSpan;
      bunkerObj.scale.setScalar(BUNKER_SCALE);
      bunkerObj.updateMatrixWorld(true);
      bunkerObj.traverse(child => {
        if (child.isMesh) {
          child.material = materialFor(child.name, tex);
          child.castShadow = true; child.receiveShadow = true;
          child.geometry.computeBoundingBox();
          const b = child.geometry.boundingBox.clone().applyMatrix4(child.matrixWorld);
          if (child.name.toLowerCase().includes('wall')) wallBoxes.push(b);
          levelBounds.union(b);
        }
      });
      scene.add(bunkerObj);
      floorY = levelBounds.min.y;

      // 실제 맵 크기에 맞춰 안개/카메라 원거리 클리핑을 다시 계산 (검은 화면 방지)
      const boundsSize = new THREE.Vector3(); levelBounds.getSize(boundsSize);
      const diag = Math.max(boundsSize.length(), 10);
      scene.fog = new THREE.FogExp2(0x000000, Math.max(0.02, 2.2 / diag));
      camera.far = Math.max(150, diag * 2);
      camera.updateProjectionMatrix();

      playerRig.position.set(
        (levelBounds.min.x + levelBounds.max.x) / 2,
        floorY,
        (levelBounds.min.z + levelBounds.max.z) / 2
      );
      const cx = (levelBounds.min.x + levelBounds.max.x) / 2;
      const cz = (levelBounds.min.z + levelBounds.max.z) / 2;
      const rx = (levelBounds.max.x - levelBounds.min.x) * 0.35;
      const rz = (levelBounds.max.z - levelBounds.min.z) * 0.35;
      for (let i = 0; i < 24; i++) {
        npcSpawnPoints.push(new THREE.Vector3(
          cx + (Math.random() * 2 - 1) * rx, floorY, cz + (Math.random() * 2 - 1) * rz
        ));
      }

      // ---- 메뉴 미리보기용 오브젝트 (정규화된 크기 기준으로 자동 프레이밍) ----
      previewObj = aooniObj;
      previewScene.add(aooniObj);
      const fitDist = (size.y / (2 * Math.tan(THREE.MathUtils.degToRad(previewCam.fov / 2)))) * 1.65;
      previewCam.position.set(0, size.y * 0.55, fitDist);
      previewCam.lookAt(0, size.y * 0.52, 0);

      // ---- 게임 플레이용 캐릭터 (스켈레톤 포함 복제 → 미리보기와 독립적으로 애니메이션) ----
      playerModel = THREE.SkeletonUtils && THREE.SkeletonUtils.clone
        ? THREE.SkeletonUtils.clone(aooniObj)
        : aooniObj.clone(true);
      playerModel.traverse(child => { if (child.isMesh) child.castShadow = true; });
      playerRig.add(playerModel);

      eyeLight = new THREE.PointLight(0xff2b2b, 2.4, 10, 2);
      eyeLight.position.set(0, size.y * 0.92, size.z || 0.2);
      playerModel.add(eyeLight);

      charMixer = new THREE.AnimationMixer(playerModel);
      previewMixer = new THREE.AnimationMixer(previewObj);

      setLoading(72, '애니메이션을 불러오는 중... (기본)');
      const baseAnims = aooniObj.animations || [];
      if (baseAnims[0]) {
        charAnims.idle = { clip: baseAnims[0], action: charMixer.clipAction(baseAnims[0]) };
        previewIdleAction = previewMixer.clipAction(baseAnims[0]);
        previewIdleAction.play();
      }

      setLoading(80, '애니메이션을 불러오는 중... (걷기)');
      const walkObj = await loadFBX(ASSET.animWalk);
      if (walkObj.animations[0]) charAnims.walk = { clip: walkObj.animations[0], action: charMixer.clipAction(walkObj.animations[0]) };

      setLoading(88, '애니메이션을 불러오는 중... (질주)');
      const runObj = await loadFBX(ASSET.animRun);
      if (runObj.animations[0]) charAnims.run = { clip: runObj.animations[0], action: charMixer.clipAction(runObj.animations[0]) };

      setLoading(95, '애니메이션을 불러오는 중... (점프)');
      const jumpObj = await loadFBX(ASSET.animJump);
      if (jumpObj.animations[0]) {
        charAnims.jump = { clip: jumpObj.animations[0], action: charMixer.clipAction(jumpObj.animations[0]) };
        charAnims.jump.action.setLoop(THREE.LoopOnce);
        charAnims.jump.action.clampWhenFinished = true;
      }

      if (charAnims.idle) {
        currentAction = charAnims.idle.action;
        currentAction.play();
      }

      setLoading(100, '준비 완료');
      document.getElementById('loading').style.display = 'none';
      document.getElementById('menu').style.display = 'flex';
      document.getElementById('startBtn').disabled = false;
      document.getElementById('startBtn').textContent = '사냥 시작';

      animate();
    } catch (err) {
      fatalError('에셋 로딩 실패', err);
    }
  }

  boot();
})();
