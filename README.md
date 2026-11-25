# argusDesk

Jira 서비스데스크를 작은 풀필먼트 센터로 보여주는 데스크톱 앱입니다. 티켓은 상자, 상태는 구역, 담당자는 책상이 됩니다. macOS와 Windows에서 동작합니다.

지금은 **0단계(읽기 전용)** 입니다. 티켓을 읽어 배치하고 묵은 상자를 표시하지만, 상태 전환과 승인은 아직 Jira에서 합니다.

## 동작 방식

- 서버가 없습니다. 앱이 Jira를 60초마다 직접 읽습니다.
- 로그인은 개인 Jira API 토큰으로 하고, 토큰은 운영체제의 자격 증명 저장소에만 둡니다.
- 구역, 워크플로우, 묵은 상자 기준은 YAML 설정 파일로 정합니다. 앱은 처음 실행할 때 고른 파일의 위치를 기억하고 실행할 때마다 다시 읽습니다.
- 티켓 내용은 메모리에만 두고 디스크에 쓰지 않습니다.

## 설정 파일

`config/example.yaml`이 형식을 보여주는 예시이고, 안의 이름과 ID는 모두 가짜입니다.

실제 설정 파일에는 사내 Jira의 유형, 상태, 승인 단계가 들어가므로 **이 저장소에 올리지 않습니다.** `.gitignore`가 `config/` 아래의 다른 YAML과 `dba-center*.yaml`을 막고 있습니다.

## 개발

필요한 것: Go 1.26 이상, Node.js 22 이상.

```sh
./scripts/bootstrap.sh   # 처음 한 번: Go 모듈, Wails 빌드 파일, 프론트엔드 패키지
wails3 dev               # 앱 실행
go test ./internal/...   # 테스트
```

화면만 가짜 데이터로 보려면 Go 없이 브라우저에서 실행할 수 있습니다.

```sh
cd frontend && npm install && npm run dev:mock
```

화면을 만들기 전에 배치가 Jira와 맞는지 글자로 확인하는 명령이 있습니다.

```sh
ARGUSDESK_TOKEN=<API 토큰> go run ./cmd/argusdesk-dump -config <설정 파일> -email <Jira 이메일>
```

## 구조

```
main.go, app.go      Wails 앱과 화면에 노출하는 함수
internal/
  jira/      Jira REST 호출
  board/     티켓을 구역에 배치하고 변경을 찾는다
  stale/     묵은 상자 판정
  config/    설정 파일 읽기와 검사
  secret/    토큰 보관, 개인 설정
  update/    자동 업데이트
  model/     화면에 넘기는 데이터
frontend/src/
  scene.ts   PixiJS로 그리는 센터
  panel.ts   티켓 패널
  mock.ts    프로토타입용 가짜 데이터
```

## 저장소에 넣지 않는 것

토큰과 계정 정보, 실제 티켓 내용, 실제 화면 스크린샷, 팀원 이름, 실제 설정 파일. 테스트와 예시는 가짜 이름으로 씁니다.

## 릴리스

`release-notes/README.md`를 보세요. `v*` 태그를 푸시하면 GitHub Actions가 빌드해 릴리스를 올리고, 설치된 앱이 그 릴리스를 찾아 스스로 업데이트합니다.
