# AO-ONI: BUNKER

아오오니의 시점으로 벙커 맵을 돌아다니며 숨은 생존자를 사냥하는 브라우저 공포 게임 (Three.js).

## GitHub Pages로 올리는 방법

1. GitHub에서 새 저장소(repository)를 만듭니다. (Public이어야 무료 Pages가 됩니다)
2. 이 폴더(`index.html`, `js/`, `assets/`) 전체를 저장소에 업로드합니다.
   - GitHub 웹사이트에서 "Add file → Upload files"로 폴더째 드래그해도 되고,
   - `git`을 쓴다면:
     ```bash
     git init
     git add .
     git commit -m "ao-oni bunker game"
     git branch -M main
     git remote add origin https://github.com/사용자명/저장소명.git
     git push -u origin main
     ```
3. 저장소 페이지에서 **Settings → Pages**로 이동합니다.
4. **Build and deployment → Source**를 `Deploy from a branch`로, **Branch**를 `main` / `(root)`로 설정하고 저장합니다.
5. 1~2분 후 `https://사용자명.github.io/저장소명/` 주소로 게임이 열립니다.

## 로컬에서 미리 테스트하기

`index.html`을 그냥 더블클릭해서 열면 **안 됩니다** — 브라우저가 `file://`에서의 fetch를 막아서
"에셋 불러오는 중..."에 멈춘 것처럼 보입니다. 반드시 로컬 서버로 열어야 합니다.

```bash
cd 이_폴더
python3 -m http.server 8000
```
그 다음 브라우저에서 `http://localhost:8000` 접속.

(VSCode를 쓴다면 "Live Server" 확장으로 열어도 됩니다.)

## 폴더 구조
```
index.html
js/
  game.js          게임 전체 로직
assets/
  models/
    bunker.fbx       벙커 맵 (모듈러 키트, 배치 완료본)
    ao_oni.fbx        아오오니 리깅 모델 + 기본 애니메이션
    Unarmed_Idle_Looking_Ver__2.fbx  대기(가만히 있을 때) 애니메이션
    anim_walk.fbx      걷기 애니메이션
    anim_run.fbx       질주 애니메이션
    anim_jump.fbx      점프 애니메이션
  textures/
    ao_oni_diffuse.png
    wall_albedo.png / wall_normal.png
    floor_albedo.png / floor_normal.png
    ceiling_albedo.png / ceiling_normal.png
```

## 조작
- `WASD` 이동
- `Shift` 질주
- `Space` 점프
- 마우스로 시점 회전
- 마우스 휠로 카메라 확대/축소
- `ESC` 일시정지

## 목표
150초 안에 벙커에 흩어진 생존자 5명을 모두 붙잡으면 승리, 시간 초과 시 패배.

## 문제가 생기면
브라우저 콘솔(F12 → Console)을 열어서 나오는 에러 메시지를 확인해주세요.
로딩 화면에 멈춰 있다면 대부분 (1) file://로 직접 연 경우, (2) 저장소에 assets 폴더가
통째로 안 올라간 경우입니다.
