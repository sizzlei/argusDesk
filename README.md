# argusDesk

Jira 서비스데스크를 작은 풀필먼트 센터로 보여주는 데스크톱 앱입니다. 티켓은 상자, 상태는 구역, 담당자는 책상이 됩니다. macOS와 Windows에서 동작합니다.

팀 서버인 Argus와 함께 씁니다. Argus가 로그인, 팀 설정, 휴가 같은 팀 공용 정보를 맡고, 티켓은 앱이 각자의 Jira 권한으로 직접 읽고 처리합니다.

## 동작 방식

- 시작은 Argus 로그인입니다. 앱에 Argus 주소를 입력하면 브라우저에서 로그인하고, 설정과 본인의 Jira API 토큰을 Argus에서 받아 옵니다.
- 티켓은 앱이 Jira를 60초마다 직접 읽습니다. Argus는 Jira와 통신하지 않습니다.
- 받아 온 토큰은 운영체제의 자격 증명 저장소에만 둡니다.
- 구역, 워크플로우, 묵은 상자 기준은 YAML 설정으로 정하고, Argus 관리 화면에 올려 배포합니다.
- 티켓 내용은 메모리에만 두고 디스크에 쓰지 않습니다.

## 설정 파일

`config/example.yaml`이 형식을 보여주는 예시이고, 안의 이름과 ID는 모두 가짜입니다. 항목마다의 뜻과 보드를 추가하는 순서는 [설정 가이드](docs/설정-가이드.md)에 있습니다.

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
