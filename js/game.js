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
  // (맵이 너무 어둡다는 피드백 반영 — 공포감은 안개/비네트로 유지하고 기본 밝기는 올림)
  const ambient = new THREE.AmbientLight(0x1c1c2c, 1.1);
  scene.add(ambient);
  const hemi = new THREE.HemisphereLight(0x4a4a68, 0x0a0a10, 1.0);
  scene.add(hemi);
  const fill = new THREE.DirectionalLight(0x99aaff, 0.45);
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
    bunker: 'assets/models/house/house.fbx',
    aooni: 'assets/models/ao_oni.fbx',
    aooniIdle: 'assets/models/Unarmed_Idle_Looking_Ver__2.fbx',
    animWalk: 'assets/models/anim_walk.fbx',
    animRun: 'assets/models/anim_run.fbx',
    animJump: 'assets/models/anim_jump.fbx',
    survivor: 'assets/models/survivor.fbx',
    aooniTex: 'assets/textures/ao_oni_diffuse.png',
    wallAlbedo: 'assets/textures/wall_albedo.png',
    wallNormal: 'assets/textures/wall_normal.png',
    floorAlbedo: 'assets/textures/floor_albedo.png',
    floorNormal: 'assets/textures/floor_normal.png',
    ceilAlbedo: 'assets/textures/ceiling_albedo.png',
    ceilNormal: 'assets/textures/ceiling_normal.png',
    // 새 맵(그래니 하우스)은 FBX 안에 방마다 다른 텍스처가 이미 구워져 있어서 위 wall/floor/ceil
    // 텍스처는 쓰이지 않는다(아래 재질 처리 로직 참고). 다만 벽·바닥은 별도의 고화질 노멀맵을
    // 덧씌워서 요철감만 살짝 보강한다.
    houseWallNormalExtra: 'assets/models/house/HouseWallsNormal.png',
    houseFloorNormalExtra: 'assets/models/house/HouseFloorsNormal.png',
  };

  const wallMeshes = []; // 벽 메시 원본 오브젝트 (문틀처럼 구멍이 있는 형태의 "진짜" 충돌 판정을 위해 사용)
  const floorBoxes = []; // 바닥 타일 각각의 개별 박스 (스폰 위치를 "진짜 바닥 위"로 스냅하는 데 사용)
  // 계단/경사로처럼 "floor"라는 이름이 안 붙어 있는 메시도 실제로는 밟고 올라갈 수 있어야 한다.
  // 천장(ceil)만 제외한 나머지 전부(벽+바닥+계단+이름 모를 소품 등)를 "발밑 높이 판정용" 대상으로 삼는다.
  // 아래로 레이를 쏴서 "지금 서 있는 자리 바로 아래의 실제 표면 높이"를 매 프레임 구하는 데 사용한다.
  const groundMeshes = [];
  let levelBounds = new THREE.Box3();  // 벽+바닥+천장 (이동/카메라 범위 클램프용)
  let floorBounds = new THREE.Box3();  // 바닥만 (스폰 위치 기준 — 맵 안에서 시작하도록)
  let floorY = 0;
  let npcSpawnPoints = [];
  let bunkerObj = null;

  // 벽/바닥/천장 노멀이 뒤집혀 있어도(자주 있는 FBX 내보내기 실수) 안쪽에서
  // 검게 사라지지 않도록 DoubleSide로 렌더링한다.
  // ⚠ 이 함수는 "메시 자체에 텍스처가 없는" 모델(예전 bunker.fbx처럼 맨 지오메트리만 있는 경우)에만
  //   쓰는 대체(fallback) 재질이다. 그래니 하우스처럼 FBX 안에 이미 텍스처가 구워져 있는 모델은
  //   boot()의 bunkerObj.traverse에서 원래 재질을 그대로 쓰고 이 함수를 호출하지 않는다.
  function materialFor(name, tex) {
    const n = name.toLowerCase();
    if (n.includes('wall')) return new THREE.MeshStandardMaterial({ map: tex.wallAlbedo, normalMap: tex.wallNormal, roughness: 0.95, metalness: 0.05, side: THREE.DoubleSide });
    if (n.includes('floor')) return new THREE.MeshStandardMaterial({ map: tex.floorAlbedo, normalMap: tex.floorNormal, roughness: 0.9, metalness: 0.05, side: THREE.DoubleSide });
    if (n.includes('ceil')) return new THREE.MeshStandardMaterial({ map: tex.ceilAlbedo, normalMap: tex.ceilNormal, roughness: 0.95, metalness: 0.05, side: THREE.DoubleSide });
    return new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 1, side: THREE.DoubleSide });
  }

  // 스킨드 메시(뼈대 있는 캐릭터)를 애니메이션과 함께 독립적으로 복제하는 함수.
  // ⚠ 이전 버전은 CDN에서 THREE.SkeletonUtils.js를 따로 불러와 썼는데, 그 스크립트가
  //   실패/미로딩되면 조용히 object.clone(true)로 대체되었고, 이 경우 복제본의 뼈(Bone)들이
  //   원본과 올바르게 다시 연결되지 않아 "믹서는 재생되는데 메쉬는 안 움직이는" 현상이 생긴다.
  //   → 외부 스크립트에 의존하지 않도록 필요한 로직만 이 파일 안에 직접 넣는다.
  function cloneSkinned(source) {
    const cloneMap = new Map();
    const clone = source.clone();
    (function walk(a, b) {
      cloneMap.set(a, b);
      for (let i = 0; i < a.children.length; i++) walk(a.children[i], b.children[i]);
    })(source, clone);
    source.traverse(node => {
      if (!node.isSkinnedMesh) return;
      const clonedNode = cloneMap.get(node);
      clonedNode.skeleton = node.skeleton.clone();
      clonedNode.skeleton.bones = node.skeleton.bones.map(bone => cloneMap.get(bone));
      clonedNode.bindMatrix.copy(node.bindMatrix);
      clonedNode.bind(clonedNode.skeleton, clonedNode.bindMatrix);
    });
    return clone;
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

  // ---------- 카메라 줌 (마우스 휠) ----------
  const ZOOM_MIN = 0.4;  // FOLLOW_DIST 배율 최소값 (많이 당김)
  const ZOOM_MAX = 2.2;  // FOLLOW_DIST 배율 최대값 (많이 멀어짐)
  let followZoom = 1;
  addEventListener('wheel', e => {
    followZoom = THREE.MathUtils.clamp(followZoom + e.deltaY * 0.0015, ZOOM_MIN, ZOOM_MAX);
    e.preventDefault();
  }, { passive: false });

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
  // ---------- 점프 시 실제로 몸이 떠오르는 상하 움직임 ----------
  // ⚠ 예전 버전은 점프 애니메이션(제자리 모션)만 재생하고 캐릭터의 실제 위치(y)는
  //   전혀 바뀌지 않아서, 서 있는 자리에서 팔다리만 움직이고 몸은 뜨지 않는 것처럼 보였다.
  //   → playerRig(발밑 기준 위치, 지형 충돌/카메라 추적에 사용) 자체는 그대로 두고,
  //     그 자식인 playerModel(눈에 보이는 캐릭터 메시)의 y좌표에 사인 곡선 기반의
  //     "떴다가 착지하는" 오프셋을 더해준다. 지형 스냅(updateStandingHeight)과
  //     충돌 판정은 여전히 playerRig 기준으로만 동작하므로 계단/바닥 로직과 절대 충돌하지 않는다.
  const JUMP_DURATION = 0.7;  // 점프 애니메이션 길이(초)와 맞춤
  const JUMP_HEIGHT = 0.55;   // 최고 높이(m)
  let jumping = false;
  let jumpElapsed = 0;
  function triggerJump() {
    if (jumping || !gameActive) return;
    jumping = true;
    jumpElapsed = 0;
    playAction('jump', 0.1);
    setTimeout(() => { jumping = false; }, JUMP_DURATION * 1000);
  }

  const PLAYER_RADIUS = 0.35;

  // ⚠ 예전 방식은 벽 메시 "전체 바운딩 박스"가 막혔는지만 봤다. 문틀처럼 가운데가 뚫린(구멍 있는)
  //   벽 조각은 실제 지오메트리와 상관없이 바운딩 박스가 문 전체(뚫린 구멍까지) 네모나게 감싸버려서,
  //   문이 열려 있어도 통과할 수 없는 원인이 됐다.
  //   → 실제 삼각형 지오메트리에 레이캐스트를 쏴서 "진짜로 뭔가 막고 있는지"를 확인한다.
  //   문 구멍처럼 지오메트리가 없는 곳은 레이가 아무것도 맞히지 않으므로 정상적으로 통과된다.
  const moveRay = new THREE.Raycaster();
  // baseY: 이 판정을 하는 캐릭터의 "현재 발밑 높이". 예전에는 항상 고정된 floorY를 썼는데,
  // 계단을 오르는 플레이어처럼 발밑 높이가 바뀌는 경우 그대로 두면 판정용 광선이
  // 계단 몸체 "안쪽"(바닥보다 낮은 위치)에서 나가버려 사방이 다 막힌 것처럼 오판된다.
  // → 호출하는 쪽(플레이어는 현재 y, NPC는 floorY)에서 기준 높이를 넘기도록 한다.
  function rayBlocked(px, pz, ndx, ndz, dist, radius, baseY = floorY) {
    if (!wallMeshes.length || dist <= 0) return false;
    const perp = new THREE.Vector3(-ndz, 0, ndx); // 이동 방향에 수직인 축 (플레이어 폭을 흉내내기 위한 오프셋)
    const offsets = [-radius * 0.85, 0, radius * 0.85];
    const heights = [0.35, 1.5]; // 발목 근처 + 머리 근처, 둘 다 확인해서 낮은 장애물/문 상단 모두 감지
    const dir = new THREE.Vector3(ndx, 0, ndz);
    for (const off of offsets) {
      const ox = px + perp.x * off;
      const oz = pz + perp.z * off;
      for (const h of heights) {
        moveRay.set(new THREE.Vector3(ox, baseY + h, oz), dir);
        moveRay.near = 0;
        moveRay.far = dist + radius + 0.05;
        if (moveRay.intersectObjects(wallMeshes, false).length) return true;
      }
    }
    return false;
  }

  function tryMove(dx, dz) {
    const pos = playerRig.position;
    const distX = Math.abs(dx), distZ = Math.abs(dz);
    const blockedX = distX > 1e-6 && rayBlocked(pos.x, pos.z, Math.sign(dx), 0, distX, PLAYER_RADIUS, pos.y);
    const blockedZ = distZ > 1e-6 && rayBlocked(pos.x, pos.z, 0, Math.sign(dz), distZ, PLAYER_RADIUS, pos.y);
    pos.x = blockedX ? pos.x : pos.x + dx;
    pos.z = blockedZ ? pos.z : pos.z + dz;
  }

  // ---------- 계단/경사로 "밟고 올라가기·내려가기" ----------
  // 발밑으로 레이를 쏴서 실제 표면 높이를 구한다. 계단처럼 한 칸의 높이차가 작으면
  // 즉시(또는 부드럽게) 그 높이로 스냅해서 "타고 오르내리는" 느낌을 준다.
  // 높이차가 너무 크면(진짜 수직 벽/턱) 원래 높이를 유지해서 뚫고 올라가지 않는다.
  //
  // ⚠ 예전 버전은 "정중앙 한 지점에서 아래로 광선 1개"만 쏴서 가장 먼저 맞은 면을 무조건
  //   바닥으로 인식했다. 그런데 계단 난간, 계단 옆판, 리모델링 파츠처럼 수직에 가깝게
  //   서 있는 얇은 면이 캐릭터 발밑 정중앙을 살짝이라도 가리면 그 면의 높이를 "바닥"으로
  //   착각해서, 실제 디딤판은 더 아래에 있는데도 난간 위에 붕 뜨거나(내려가려던 방향이
  //   막힌 것처럼) 멈춰버리는 오작동이 났다. → 아래 두 가지로 훨씬 안정적으로 고쳤다:
  //   1) 맞은 면의 "월드 기준 법선"이 충분히 위를 향할 때만(수직에 가까운 면은 제외)
  //      바닥으로 인정한다.
  //   2) 발밑 정중앙 1개가 아니라 주변 4곳(±0.18m)까지 총 5곳에서 각각 검사한 뒤,
  //      중앙값(median)을 사용한다 — 한두 지점이 난간/틈새에 걸려 튀는 값이 나와도
  //      나머지 다수의 정상적인 디딤판 높이에 묻혀 무시된다.
  const groundRay = new THREE.Raycaster();
  const STEP_MAX = 0.6;      // 한 번에 오를/내릴 수 있는 최대 높이차 (계단 한두 칸 정도)
  const GROUND_PROBE_UP = 2.5; // 발밑 탐색을 시작할 때 얼마나 위에서부터 아래로 쏠지
  const DOWN = new THREE.Vector3(0, -1, 0);
  const GROUND_SAMPLE_OFFSETS = [[0, 0], [0.18, 0], [-0.18, 0], [0, 0.18], [0, -0.18]];
  function rawGroundHit(x, z, aroundY) {
    groundRay.set(new THREE.Vector3(x, aroundY + GROUND_PROBE_UP, z), DOWN);
    groundRay.near = 0;
    groundRay.far = GROUND_PROBE_UP + STEP_MAX + 3;
    const hits = groundRay.intersectObjects(groundMeshes, false);
    for (const hit of hits) {
      if (!hit.face) continue; // 면 정보가 없으면(라인/포인트 지오메트리 등) 판정 불가 → 건너뜀
      const worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      if (worldNormal.y > 0.5) return hit.point.y; // 충분히 "위쪽"을 향한 면만 바닥으로 인정 (난간/벽면 제외)
    }
    return null;
  }
  function sampleGroundY(x, z, aroundY) {
    if (!groundMeshes.length) return null;
    const readings = [];
    for (const [ox, oz] of GROUND_SAMPLE_OFFSETS) {
      const y = rawGroundHit(x + ox, z + oz, aroundY);
      if (y !== null) readings.push(y);
    }
    if (!readings.length) return null;
    readings.sort((a, b) => a - b);
    return readings[Math.floor(readings.length / 2)]; // 중앙값
  }
  function updateStandingHeight(pos) {
    const groundY = sampleGroundY(pos.x, pos.z, pos.y);
    if (groundY === null) return; // 밑에 아무 표면도 없으면(맵 경계 등) 이전 높이를 그대로 유지
    const diff = groundY - pos.y;
    if (Math.abs(diff) <= STEP_MAX) {
      // 계단/경사로 정도의 높이차는 부드럽게 따라간다 (뚝뚝 끊기지 않도록 살짝 보간)
      pos.y = THREE.MathUtils.lerp(pos.y, groundY, diff > 0 ? 0.35 : 0.5);
    }
    // diff가 STEP_MAX보다 크면 진짜 벽/턱으로 보고 높이를 바꾸지 않는다.
  }

  // ---------- NPC (생존자) — CylinderGeometry 기반 캡슐 형태 (CapsuleGeometry는 구버전 three.js에 없음) ----------
  // ⚠ survivorTemplate 로딩에 실패했을 때만 쓰는 예전 방식의 대체(fallback) 모양이다.
  function makeCapsuleMesh(mat) {
    const g = new THREE.Group();
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.9, 10), mat);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), mat);
    const bot = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), mat);
    top.position.y = 0.45; bot.position.y = -0.45;
    g.add(cyl, top, bot);
    return g;
  }

  // 정규화·본 이름 리타게팅이 끝난 생존자(도망자) 원본 모델. boot()에서 채워진다.
  // 이 원본 자체는 씬에 추가되지 않고, Survivor마다 cloneSkinned()로 복제해서 쓴다.
  let survivorTemplate = null;

  class Survivor {
    constructor(pos) {
      let g, mixer = null, anims = { idle: null, walk: null, run: null }, currentAction = null;
      if (survivorTemplate) {
        // ---- 스틱맨 모델 사용: 아오오니가 쓰는 idle/walk/run 애니메이션 클립을 그대로 재사용 ----
        g = cloneSkinned(survivorTemplate);
        g.traverse(child => { if (child.isMesh) child.castShadow = true; });
        mixer = new THREE.AnimationMixer(g);
        if (charAnims.idle) anims.idle = mixer.clipAction(charAnims.idle.clip);
        if (charAnims.walk) anims.walk = mixer.clipAction(charAnims.walk.clip);
        if (charAnims.run) anims.run = mixer.clipAction(charAnims.run.clip);
        currentAction = anims.walk || anims.idle || anims.run;
        if (currentAction) currentAction.play();
      } else {
        // ---- 모델 로딩 실패 시 예전 캡슐+구 형태로 대체 ----
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd8c9a0, roughness: 0.8 });
        const body = makeCapsuleMesh(bodyMat);
        body.position.y = 0.85;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), bodyMat);
        head.position.y = 1.55;
        g = new THREE.Group();
        g.add(body, head);
      }
      g.position.copy(pos);
      g.userData.caught = false;
      this.mesh = g;
      this.mixer = mixer;
      this.anims = anims;
      this.currentAction = currentAction;
      this.state = 'wander';
      this.target = pos.clone();
      this.speed = 1.1;
      this.standY = pos.y; // 이 생존자가 현재 서 있는 실제 지형(계단 포함) 높이
      this.pickNewWanderTarget();
      scene.add(g);
    }
    pickNewWanderTarget() {
      const p = npcSpawnPoints[Math.floor(Math.random() * npcSpawnPoints.length)];
      this.target = p.clone();
    }
    // 아오오니(playAction)와 같은 방식의 크로스페이드 애니메이션 전환.
    playAnim(name, fade = 0.2) {
      const next = this.anims[name];
      if (!next || this.currentAction === next) return;
      next.reset().fadeIn(fade).play();
      if (this.currentAction) this.currentAction.fadeOut(fade);
      this.currentAction = next;
    }
    update(dt, playerPos) {
      if (this.mesh.userData.caught) return;
      if (this.mixer) this.mixer.update(dt);
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
      let moving = toTarget.length() >= 0.4;
      if (!moving) {
        if (this.state === 'wander') this.pickNewWanderTarget();
      } else {
        toTarget.normalize();
        const step = toTarget.multiplyScalar(this.speed * dt);
        const stepDist = step.length();
        // 벽 충돌 판정도 이 생존자가 지금 서 있는 높이(standY) 기준으로 해야
        // 계단 위에 있을 때 "고정된 바닥 높이" 기준 판정처럼 계단 몸체 안에서 광선이 나가
        // 사방이 막힌 것으로 오판되지 않는다.
        const blocked = stepDist > 1e-6 && rayBlocked(this.mesh.position.x, this.mesh.position.z, step.x / stepDist, step.z / stepDist, stepDist, 0.3, this.standY);
        const nx = this.mesh.position.x + step.x, nz = this.mesh.position.z + step.z;
        if (!blocked) { this.mesh.position.x = nx; this.mesh.position.z = nz; }
        else { moving = false; if (this.state === 'wander') this.pickNewWanderTarget(); }
        this.mesh.rotation.y = Math.atan2(step.x, step.z);
      }
      // 플레이어와 동일한 방식으로 발밑 지형(계단/경사로) 높이를 따라간다.
      const groundY = sampleGroundY(this.mesh.position.x, this.mesh.position.z, this.standY);
      if (groundY !== null && Math.abs(groundY - this.standY) <= STEP_MAX) {
        this.standY = THREE.MathUtils.lerp(this.standY, groundY, groundY > this.standY ? 0.35 : 0.5);
      }
      if (this.mixer) {
        // 실제 걷기/뛰기 애니메이션이 이미 상하 움직임을 표현하므로 예전의 인위적인 bob은 뺀다.
        this.mesh.position.y = this.standY;
        if (!moving) this.playAnim('idle');
        else if (this.state === 'flee') this.playAnim('run');
        else this.playAnim('walk');
      } else {
        const bob = Math.sin(performance.now() * 0.01 * (this.state === 'flee' ? 2 : 1)) * 0.03;
        this.mesh.position.y = this.standY + bob;
      }
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

    // 점프 상하 오프셋 계산 (사인 곡선: 0 → 최고점 → 0, JUMP_DURATION초에 걸쳐 착지)
    let jumpOffsetY = 0;
    if (jumping) {
      jumpElapsed += dt;
      const t = Math.min(jumpElapsed / JUMP_DURATION, 1);
      jumpOffsetY = Math.sin(Math.PI * t) * JUMP_HEIGHT;
    }
    if (playerModel) playerModel.position.y = jumpOffsetY;

    // 마우스 시점(회전)은 PointerLockControls가 camera.quaternion에 직접 반영한다.
    camera.getWorldDirection(fullDir);
    flatDir.set(fullDir.x, 0, fullDir.z).normalize();

    if (gameActive && controls.isLocked) {
      const moving = moveState.f || moveState.b || moveState.l || moveState.r;
      const speedMul = moveState.sprint ? 4.2 : 2.4;
      const speed = speedMul * dt;
      let dx = 0, dz = 0;
      // ⚠ 이전 버전은 부호가 반대로 되어 있어 A/D(좌/우 스트레이프)가 서로 뒤바뀌어 있었다.
      //   카메라 정면(flatDir)이 (0,0,-1)일 때 실제 "오른쪽"은 (1,0,0)이어야 하는데
      //   (flatDir.z, 0, -flatDir.x)는 (-1,0,0), 즉 반대 방향을 가리키고 있었다.
      const rightDir = new THREE.Vector3(-flatDir.z, 0, flatDir.x);
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
      updateStandingHeight(playerRig.position); // 계단/경사로를 밟으면 그 높이로 자연스럽게 올라간다
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

    // ---------- 3인칭 카메라: playerRig를 따라가며 벽/천장을 뚫지 않도록 레이캐스트로 거리 보정 ----------
    // ⚠ 예전 코드는 -fullDir(수평에 가까운) 방향으로만 레이를 쏴서 "안전 거리"를 구한 뒤,
    //   그 결과에 FOLLOW_LIFT(위로 들어올리는 오프셋)를 레이캐스트가 끝난 "뒤"에 더했다.
    //   그래서 레이캐스트로는 벽 뒤에 안 걸린다고 판단해놓고, 그 다음 위로 밀어 올리면서
    //   낮은 천장을 그대로 뚫고 들어가는 문제가 있었다 (Y좌표는 clamp도 안 하고 있었음).
    //   → FOLLOW_LIFT까지 포함한 "최종 목표 지점"을 먼저 정하고, anchor→그 지점 전체 구간을
    //   레이캐스트해서 어떤 방향(천장 포함)으로도 파고들지 않게 한다.
    const anchor = new THREE.Vector3(playerRig.position.x, playerRig.position.y + LOOK_HEIGHT + jumpOffsetY, playerRig.position.z);
    const camDistBase = FOLLOW_DIST * followZoom;
    const desired = new THREE.Vector3(
      anchor.x - fullDir.x * camDistBase,
      anchor.y - fullDir.y * camDistBase + FOLLOW_LIFT,
      anchor.z - fullDir.z * camDistBase
    );
    let camPos = desired;
    if (bunkerObj) {
      const toDesired = desired.clone().sub(anchor);
      const fullLen = toDesired.length();
      if (fullLen > 0.001) {
        const dir = toDesired.clone().normalize();
        camRay.set(anchor, dir);
        camRay.far = fullLen + 0.3;
        camRay.near = 0.05;
        const hits = camRay.intersectObject(bunkerObj, true);
        if (hits.length && hits[0].distance < fullLen) {
          const safeDist = Math.max(0.3, hits[0].distance - 0.25);
          camPos = anchor.clone().add(dir.multiplyScalar(safeDist));
        }
      }
    }
    camera.position.set(
      THREE.MathUtils.clamp(camPos.x, levelBounds.min.x + 0.1, levelBounds.max.x - 0.1),
      THREE.MathUtils.clamp(camPos.y, levelBounds.min.y + 0.15, levelBounds.max.y - 0.15),
      THREE.MathUtils.clamp(camPos.z, levelBounds.min.z + 0.1, levelBounds.max.z - 0.1)
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
        // 그래니 하우스 맵의 벽/바닥에 덧씌우는 고화질 노멀맵. 이 메시들은 UV가 하나로 통째로
        // 구워져 있어서(타일링 반복 X) tileable=false로 불러와야 기존 텍스처와 어긋나지 않는다.
        ['houseWallNormalExtra', false, false], ['houseFloorNormalExtra', false, false],
      ];
      for (let i = 0; i < texJobs.length; i++) {
        const [key, srgb, tileable] = texJobs[i];
        try {
          tex[key] = await loadTexture(ASSET[key], srgb, tileable);
        } catch (e) {
          // houseWallNormalExtra/houseFloorNormalExtra는 "있으면 더 예뻐지는" 보너스 텍스처일 뿐이라
          // 파일이 없거나 경로가 다르다고 해서 게임 전체가 멎으면 안 된다 → 그 텍스처만 건너뛴다.
          if (key === 'houseWallNormalExtra' || key === 'houseFloorNormalExtra') {
            console.warn(`(무시하고 계속 진행) ${key} 텍스처를 못 불러왔습니다:`, e);
          } else {
            throw e;
          }
        }
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
          // ⚠ skinning:true가 빠져 있으면 SkinnedMesh라도 셰이더가 뼈(Bone) 변형을 무시한다.
          //   그래서 AnimationMixer/스켈레톤은 정상적으로 갱신되는데도(콘솔 경고 없음, 본 값은 실제로 변함)
          //   화면에는 계속 바인드포즈(정지 자세)로만 보이는 현상이 발생했다 — 이번 "애니메이션 미적용" 버그의 원인.
          child.material = new THREE.MeshStandardMaterial({ map: tex.aooniTex, roughness: 0.8, side: THREE.DoubleSide, skinning: true });
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
          const n = child.name.toLowerCase();
          const isWall = n.includes('wall');
          const isFloor = n.includes('floor');
          const isCeil = n.includes('ceil');
          // ⚠ 예전에는 모든 메시의 재질을 무조건 materialFor()(벽/바닥/천장용 절차적 텍스처, 그 외엔
          //   밋밋한 회색)로 덮어썼다. bunker.fbx처럼 지오메트리만 있고 텍스처가 없는 모델은 그래도
          //   되지만, 그래니 하우스처럼 방마다 이미 텍스처가 구워져 있는 모델에 그대로 적용하면
          //   가구·문·바닥 등 디테일이 전부 밋밋한 회색으로 뭉개져 버린다.
          //   → 메시 자체에 이미 텍스처(map)가 있으면 그 원본 재질을 그대로 쓰고, 벽/바닥에는
          //   고화질 노멀맵만 살짝 덧씌운다. 텍스처가 아예 없는 메시만 기존 방식으로 대체한다.
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          const hasOwnTexture = mats.some(m => m && m.map);
          if (hasOwnTexture) {
            mats.forEach(m => {
              if (!m) return;
              m.side = THREE.DoubleSide; // 노멀이 뒤집혀 있어도 안쪽에서 사라지지 않도록
              if (m.map) m.map.encoding = THREE.sRGBEncoding;
              if (isWall && tex.houseWallNormalExtra) m.normalMap = tex.houseWallNormalExtra;
              if (isFloor && tex.houseFloorNormalExtra) m.normalMap = tex.houseFloorNormalExtra;
              m.needsUpdate = true;
            });
            child.material = Array.isArray(child.material) ? mats : mats[0];
          } else {
            child.material = materialFor(child.name, tex);
          }
          child.castShadow = true; child.receiveShadow = true;
          child.geometry.computeBoundingBox();
          const b = child.geometry.boundingBox.clone().applyMatrix4(child.matrixWorld);
          if (isWall) wallMeshes.push(child);
          if (!isCeil) groundMeshes.push(child); // 계단/경사로 포함, 천장만 제외하고 발밑 판정 대상에 등록
          // ⚠ 레벨 경계는 벽/바닥/천장(=실제 실내 구조)만으로 계산한다.
          //   모듈러 키트에는 이름이 다른 소품/장식/외부 구조 메시가 섞여 있을 수 있는데,
          //   그런 것까지 전부 합쳐 경계를 잡으면 실제 플레이 공간보다 훨씬 커져서
          //   플레이어가 "맵 밖"의 빈 공간에서 스폰되는 원인이 된다.
          if (isWall || isFloor || isCeil) levelBounds.union(b);
          if (isFloor) { floorBounds.union(b); floorBoxes.push(b); }
        }
      });
      // 바닥 이름 규칙이 달라 못 찾았을 경우를 대비한 안전장치
      if (floorBounds.isEmpty()) floorBounds.copy(levelBounds);
      if (levelBounds.isEmpty()) levelBounds.setFromObject(bunkerObj);
      scene.add(bunkerObj);
      floorY = floorBounds.min.y;

      // 실제 맵 크기에 맞춰 안개/카메라 원거리 클리핑을 다시 계산 (검은 화면 방지).
      // 안개는 "맵이 어둡다"는 문제도 있었으므로 이전보다 더 여유 있게(옅게) 잡는다.
      const boundsSize = new THREE.Vector3(); levelBounds.getSize(boundsSize);
      const diag = Math.max(boundsSize.length(), 10);
      scene.fog = new THREE.FogExp2(0x000000, Math.max(0.012, 1.3 / diag));
      camera.far = Math.max(150, diag * 2);
      camera.updateProjectionMatrix();

      // ⚠ 예전 방식(바닥 전체를 감싸는 bounding box의 중심)은 벙커가 사각형이 아니라
      //   ㄱ자/복도형(비볼록 형태)일 때 그 "중심점"이 실제로는 어느 바닥 타일 위에도 있지 않고
      //   빈 공간(벽 바깥)에 떨어질 수 있었다. 실측해보니 6.5유닛이나 떨어진 완전한 맵 밖이었다.
      //   → 개별 바닥 타일들의 중심을 평균 낸 뒤, 그 평균과 가장 가까운 "실제 바닥 타일의 중심"으로
      //   스냅한다. 이렇게 하면 항상 진짜 바닥 위에서 시작하는 게 보장된다.
      function pickPointOnFloor(nearX, nearZ) {
        let best = null, bestDist = Infinity;
        for (const fb of floorBoxes) {
          const fcx = (fb.min.x + fb.max.x) / 2;
          const fcz = (fb.min.z + fb.max.z) / 2;
          const d = Math.hypot(fcx - nearX, fcz - nearZ);
          if (d < bestDist) { bestDist = d; best = new THREE.Vector3(fcx, floorY, fcz); }
        }
        return best;
      }
      // 그래니 하우스처럼 바닥이 "타일 여러 장"이 아니라 집 전체 모양을 한 메시 1~2개로만
      // 이루어진 경우, 그 메시의 bounding box는 사각형이라 L자/ㄷ자 형태의 움푹 들어간 부분까지
      // 통째로 포함해버린다. 그러면 위에서 구한 "박스 중심"이 실제로는 벽 바깥의 빈 공간일 수
      // 있다. → 실제로 그 지점 발밑에 밟을 수 있는 바닥이 있는지 레이캐스트로 검증하고,
      // 아니라면 바닥 타일 안에서 유효한 지점을 찾을 때까지 다시 뽑는다.
      function findWalkablePoint(nearX, nearZ) {
        const guess = pickPointOnFloor(nearX, nearZ);
        if (guess && sampleGroundY(guess.x, guess.z, floorY + 3) !== null) return guess;
        for (let attempt = 0; attempt < 40 && floorBoxes.length; attempt++) {
          const fb = floorBoxes[Math.floor(Math.random() * floorBoxes.length)];
          const tx = THREE.MathUtils.lerp(fb.min.x, fb.max.x, 0.15 + Math.random() * 0.7);
          const tz = THREE.MathUtils.lerp(fb.min.z, fb.max.z, 0.15 + Math.random() * 0.7);
          const gy = sampleGroundY(tx, tz, floorY + 3);
          if (gy !== null) return new THREE.Vector3(tx, gy, tz);
        }
        return guess; // 그래도 못 찾으면(레이캐스트 대상이 아예 없는 특수 상황) 기존 방식으로라도 시작
      }

      let cx, cz;
      if (floorBoxes.length) {
        let avgX = 0, avgZ = 0;
        for (const fb of floorBoxes) { avgX += (fb.min.x + fb.max.x) / 2; avgZ += (fb.min.z + fb.max.z) / 2; }
        avgX /= floorBoxes.length; avgZ /= floorBoxes.length;
        const spawn = findWalkablePoint(avgX, avgZ);
        cx = spawn.x; cz = spawn.z;
        if (sampleGroundY(cx, cz, floorY + 3) !== null) floorY = sampleGroundY(cx, cz, floorY + 3);
      } else {
        // 바닥 이름 규칙을 못 찾은 경우를 대비한 안전장치
        cx = (floorBounds.min.x + floorBounds.max.x) / 2;
        cz = (floorBounds.min.z + floorBounds.max.z) / 2;
      }
      playerRig.position.set(cx, floorY, cz);

      // 생존자 스폰도 같은 이유로 "실제로 밟을 수 있는 바닥 위"에서 직접 뽑는다
      // (반경/박스 랜덤 방식만으로는 벽 속이나 움푹 들어간 빈 공간에 낄 수 있었다).
      for (let i = 0; i < 24; i++) {
        if (floorBoxes.length) {
          const fb = floorBoxes[Math.floor(Math.random() * floorBoxes.length)];
          const jx = THREE.MathUtils.lerp(fb.min.x, fb.max.x, 0.25 + Math.random() * 0.5);
          const jz = THREE.MathUtils.lerp(fb.min.z, fb.max.z, 0.25 + Math.random() * 0.5);
          const gy = sampleGroundY(jx, jz, floorY + 3);
          npcSpawnPoints.push(gy !== null ? new THREE.Vector3(jx, gy, jz) : findWalkablePoint(jx, jz));
        } else {
          const rx = (floorBounds.max.x - floorBounds.min.x) * 0.35;
          const rz = (floorBounds.max.z - floorBounds.min.z) * 0.35;
          npcSpawnPoints.push(new THREE.Vector3(
            cx + (Math.random() * 2 - 1) * rx, floorY, cz + (Math.random() * 2 - 1) * rz
          ));
        }
      }

      // ---- 메뉴 미리보기용 오브젝트 (정규화된 크기 기준으로 자동 프레이밍) ----
      previewObj = aooniObj;
      previewScene.add(aooniObj);
      const fitDist = (size.y / (2 * Math.tan(THREE.MathUtils.degToRad(previewCam.fov / 2)))) * 1.65;
      previewCam.position.set(0, size.y * 0.55, fitDist);
      previewCam.lookAt(0, size.y * 0.52, 0);

      // ---- 게임 플레이용 캐릭터 (스켈레톤 포함 복제 → 미리보기와 독립적으로 애니메이션) ----
      playerModel = cloneSkinned(aooniObj);
      playerModel.traverse(child => { if (child.isMesh) child.castShadow = true; });
      playerRig.add(playerModel);

      eyeLight = new THREE.PointLight(0xff2b2b, 2.4, 10, 2);
      eyeLight.position.set(0, size.y * 0.92, size.z || 0.2);
      playerModel.add(eyeLight);

      charMixer = new THREE.AnimationMixer(playerModel);
      previewMixer = new THREE.AnimationMixer(previewObj);

      setLoading(72, '애니메이션을 불러오는 중... (대기)');
      // 가만히 있을 때(대기) 애니메이션은 사용자가 제공한 커스텀 FBX를 사용한다.
      // 본 이름(mixamorig 계열, 33본)이 아오오니 리그와 그대로 호환되는 것을 확인했다.
      // 혹시 로딩에 실패하면 원래 ao_oni.fbx에 내장된 기본 애니메이션으로 대체한다.
      let idleClip = null;
      try {
        const idleObj = await loadFBX(ASSET.aooniIdle);
        if (idleObj.animations[0]) idleClip = idleObj.animations[0];
      } catch (e) {
        console.warn('커스텀 대기 애니메이션 로딩 실패, 기본 애니메이션으로 대체합니다.', e);
      }
      if (!idleClip) idleClip = (aooniObj.animations || [])[0] || null;
      if (idleClip) {
        charAnims.idle = { clip: idleClip, action: charMixer.clipAction(idleClip) };
        previewIdleAction = previewMixer.clipAction(idleClip);
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

      // ---- 생존자(도망자) 모델: 스틱맨 리그를 불러와 아오오니 애니메이션과 호환되도록 리타게팅 ----
      // ⚠ 이 스틱맨 FBX의 본 이름은 "Root, Spine, Spine1, ..." 처럼 접두어가 없는데,
      //   아오오니용 idle/walk/run/jump 클립은 전부 "mixamorigHips, mixamorigSpine, ..."
      //   이름의 트랙으로 저장돼 있다(THREE.FBXLoader가 콜론(:)을 제거하면서 이렇게 된다).
      //   AnimationMixer는 클립의 트랙 이름과 "정확히 같은 이름의 노드"를 대상 오브젝트에서
      //   찾아서 움직이기 때문에, 이름이 다르면 애니메이션이 재생돼도 화면상 아무 움직임이 없다.
      //   → 스틱맨의 본 이름 앞에 "mixamorig"를 붙이고(루트만 Root→mixamorigHips로 매핑),
      //     아오오니와 같은 위상(계층 구조)의 본 이름 체계로 맞춰서 같은 클립을 그대로 재생한다.
      //     (손가락/발끝 본처럼 스틱맨에 없는 본을 건드리는 트랙은 조용히 무시될 뿐이라 문제 없다.)
      setLoading(97, '생존자 모델을 불러오는 중...');
      try {
        const survivorObj = await loadFBX(ASSET.survivor);
        survivorObj.traverse(child => {
          if (child.isBone) {
            child.name = child.name === 'Root' ? 'mixamorigHips' : ('mixamorig' + child.name);
          }
          if (child.isMesh) {
            child.material = new THREE.MeshStandardMaterial({ color: 0xd8c9a0, roughness: 0.85, skinning: true });
            child.castShadow = true;
          }
        });
        survivorObj.updateMatrixWorld(true);
        // 아오오니와 같은 방식으로 키를 정규화하고 발이 원점(y=0), 좌우/앞뒤 중심이 x=0,z=0에 오도록 재배치.
        const sRawBox = new THREE.Box3().setFromObject(survivorObj);
        const sRawHeight = Math.max(sRawBox.max.y - sRawBox.min.y, 0.001);
        const SURVIVOR_SCALE = 1.7 / sRawHeight; // 생존자 키를 1.7m로 정규화
        survivorObj.scale.setScalar(SURVIVOR_SCALE);
        survivorObj.updateMatrixWorld(true);
        const sBox = new THREE.Box3().setFromObject(survivorObj);
        const sCenter = new THREE.Vector3(); sBox.getCenter(sCenter);
        survivorObj.position.set(-sCenter.x, -sBox.min.y, -sCenter.z);
        survivorObj.updateMatrixWorld(true);
        survivorTemplate = survivorObj;
      } catch (e) {
        console.warn('생존자 모델 로딩 실패, 기본 캡슐 모양으로 대체합니다.', e);
        survivorTemplate = null;
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
