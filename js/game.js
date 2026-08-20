/* =========================================================
   AO-ONI: BUNKER  —  Three.js 브라우저 프로토타입 (GitHub Pages용)
   플레이어 = 아오오니. 벙커에 숨은 생존자들을 모두 잡으면 승리.

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
  scene.fog = new THREE.FogExp2(0x000000, 0.045);

  const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 500);
  camera.position.set(0, 1.6, 0);

  const eyeLight = new THREE.PointLight(0xff2b2b, 2.2, 9, 2);
  camera.add(eyeLight);
  scene.add(camera);

  const ambient = new THREE.AmbientLight(0x0a0a12, 0.55);
  scene.add(ambient);

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
  function loadTexture(url, srgb) {
    return new Promise((resolve, reject) => {
      texLoader.load(url, tex => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(1.5, 1.5);
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

  function materialFor(name, tex) {
    const n = name.toLowerCase();
    if (n.includes('wall')) return new THREE.MeshStandardMaterial({ map: tex.wallAlbedo, normalMap: tex.wallNormal, roughness: 0.95, metalness: 0.05 });
    if (n.includes('floor')) return new THREE.MeshStandardMaterial({ map: tex.floorAlbedo, normalMap: tex.floorNormal, roughness: 0.9, metalness: 0.05 });
    if (n.includes('ceil')) return new THREE.MeshStandardMaterial({ map: tex.ceilAlbedo, normalMap: tex.ceilNormal, roughness: 0.95, metalness: 0.05 });
    return new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 1 });
  }

  // ---------- 메뉴 미리보기 씬 ----------
  const previewCanvas = document.getElementById('preview');
  const previewRenderer = new THREE.WebGLRenderer({ canvas: previewCanvas, antialias: true, alpha: true });
  previewRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const previewScene = new THREE.Scene();
  const previewCam = new THREE.PerspectiveCamera(35, previewCanvas.width / previewCanvas.height, 0.1, 50);
  previewCam.position.set(0, 0.3, 3.2);
  previewScene.add(new THREE.PointLight(0xff3333, 3, 10).translateX(1).translateY(1).translateZ(2));
  previewScene.add(new THREE.AmbientLight(0x333344, 1.2));
  let previewObj = null, previewMixer = null;
  function renderPreview() {
    requestAnimationFrame(renderPreview);
    if (previewObj) previewObj.rotation.y += 0.01;
    if (previewMixer) previewMixer.update(0.016);
    previewRenderer.render(previewScene, previewCam);
  }
  renderPreview();

  // ---------- 플레이어 캐릭터 애니메이션 상태 ----------
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

  // ---------- 플레이어 컨트롤 ----------
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
    const pos = camera.position;
    const nx = pos.x + dx, nz = pos.z + dz;
    let blockedX = false, blockedZ = false;
    const testBox = (x, z) => {
      const b = new THREE.Box3(
        new THREE.Vector3(x - PLAYER_RADIUS, pos.y - 1, z - PLAYER_RADIUS),
        new THREE.Vector3(x + PLAYER_RADIUS, pos.y + 0.3, z + PLAYER_RADIUS)
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
  function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    if (charMixer) charMixer.update(dt);

    if (gameActive && controls.isLocked) {
      const moving = moveState.f || moveState.b || moveState.l || moveState.r;
      const speedMul = moveState.sprint ? 4.2 : 2.4;
      const speed = speedMul * dt;
      let dx = 0, dz = 0;
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir); dir.y = 0; dir.normalize();
      const rightDir = new THREE.Vector3(dir.z, 0, -dir.x);
      if (moveState.f) { dx += dir.x * speed; dz += dir.z * speed; }
      if (moveState.b) { dx -= dir.x * speed; dz -= dir.z * speed; }
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

      camera.position.x = THREE.MathUtils.clamp(camera.position.x, levelBounds.min.x + 0.2, levelBounds.max.x - 0.2);
      camera.position.z = THREE.MathUtils.clamp(camera.position.z, levelBounds.min.z + 0.2, levelBounds.max.z - 0.2);
      camera.position.y = floorY + 1.6 + Math.sin(now * 0.006) * (moving ? 0.03 : 0);

      for (const s of survivors) {
        s.update(dt, camera.position);
        if (!s.mesh.userData.caught && s.mesh.position.distanceTo(camera.position) < CATCH_RADIUS) {
          s.catch(); caughtCount++; scream();
          if (caughtCount >= TOTAL_SURVIVORS) endGame(true);
        }
      }

      gameTimeLeft -= dt;
      if (gameTimeLeft <= 0) { gameTimeLeft = 0; endGame(false); }
      updateHud();
    }

    renderer.render(scene, camera);
  }

  // ---------- 로딩 시퀀스 ----------
  async function boot() {
    try {
      setLoading(5, '텍스처를 불러오는 중...');
      const tex = {};
      const texJobs = [
        ['aooniTex', true], ['wallAlbedo', true], ['wallNormal', false],
        ['floorAlbedo', true], ['floorNormal', false], ['ceilAlbedo', true], ['ceilNormal', false],
      ];
      for (let i = 0; i < texJobs.length; i++) {
        const [key, srgb] = texJobs[i];
        tex[key] = await loadTexture(ASSET[key], srgb);
        setLoading(5 + (i + 1) / texJobs.length * 25, `텍스처를 불러오는 중... (${key})`);
      }
      tex.aooniTex.flipY = false;

      setLoading(32, '벙커 지도를 불러오는 중...');
      const bunkerObj = await loadFBX(ASSET.bunker);
      bunkerObj.traverse(child => {
        if (child.isMesh) {
          child.material = materialFor(child.name, tex);
          child.castShadow = true; child.receiveShadow = true;
          child.geometry.computeBoundingBox();
          const box = child.geometry.boundingBox.clone().applyMatrix4(child.matrixWorld);
          if (child.name.toLowerCase().includes('wall')) wallBoxes.push(box);
          levelBounds.union(box);
        }
      });
      scene.add(bunkerObj);
      floorY = levelBounds.min.y;
      camera.position.set(
        (levelBounds.min.x + levelBounds.max.x) / 2,
        floorY + 1.6,
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

      setLoading(60, '아오오니 모델을 불러오는 중...');
      const aooniObj = await loadFBX(ASSET.aooni);
      aooniObj.traverse(child => {
        if (child.isMesh) {
          child.material = new THREE.MeshStandardMaterial({ map: tex.aooniTex, roughness: 0.8 });
          child.castShadow = true;
        }
      });
      previewObj = aooniObj;
      aooniObj.position.set(0, -1.2, 0);
      previewScene.add(aooniObj);
      charMixer = new THREE.AnimationMixer(aooniObj);

      setLoading(72, '애니메이션을 불러오는 중... (기본)');
      const baseAnims = aooniObj.animations || [];
      if (baseAnims[0]) charAnims.idle = { clip: baseAnims[0], action: charMixer.clipAction(baseAnims[0]) };

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
      previewMixer = charMixer;

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
