#!/usr/bin/env bash
# One-time setup after cloning: fetches the Go modules and generates the Wails
# build files (build/ and Taskfile.yml), which are produced by the Wails CLI
# rather than written by hand.
#
#   ./scripts/bootstrap.sh
#
# Needs Go 1.26+, Node 22+ and the Wails v3 CLI.
set -euo pipefail
cd "$(dirname "$0")/.."

WAILS_VERSION=v3.1.0

command -v go >/dev/null || { echo "Go가 필요합니다: https://go.dev/dl/"; exit 1; }
command -v npm >/dev/null || { echo "Node.js가 필요합니다: https://nodejs.org/"; exit 1; }
if ! command -v wails3 >/dev/null; then
  echo "Wails CLI를 설치합니다 ($WAILS_VERSION)"
  go install "github.com/wailsapp/wails/v3/cmd/wails3@$WAILS_VERSION"
fi

echo "Go 모듈을 받습니다"
go get "github.com/wailsapp/wails/v3@$WAILS_VERSION" gopkg.in/yaml.v3@v3.0.1 github.com/zalando/go-keyring@latest
go mod tidy

if [ ! -f Taskfile.yml ] || [ ! -d build ]; then
  echo "Wails 빌드 파일을 만듭니다 (build/, Taskfile.yml)"
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  version=$(sed -n 's/^const Version = "\(.*\)"/\1/p' version.go)
  # Output is left on so a failure shows its reason.
  if ! (cd "$tmp" && wails3 init -n ArgusDesk -t vanilla -skipgomodtidy \
      -mod github.com/sizzlei/argusDesk \
      -productname "ArgusDesk" \
      -productdescription "Jira service desk as a fulfilment centre" \
      -productcompany "sizzlei" \
      -productidentifier "com.sizzlei.argusdesk" \
      -productversion "$version"); then
    echo "제품 정보 옵션 없이 다시 시도합니다"
    rm -rf "$tmp/ArgusDesk"
    (cd "$tmp" && wails3 init -n ArgusDesk -t vanilla -skipgomodtidy -mod github.com/sizzlei/argusDesk) ||
      { echo "wails3 init이 실패했습니다. 위의 오류 메시지를 확인해 주세요."; exit 1; }
    echo "주의: build/config.yml의 제품 이름과 식별자(com.sizzlei.argusdesk)를 직접 고쳐 주세요."
  fi
  if [ ! -d "$tmp/ArgusDesk/build" ] || [ ! -f "$tmp/ArgusDesk/Taskfile.yml" ]; then
    echo "wails3 init이 build/ 또는 Taskfile.yml을 만들지 않았습니다. 만들어진 파일:"
    ls -la "$tmp/ArgusDesk" 2>/dev/null || echo "(프로젝트 폴더가 없습니다: $tmp 안의 내용)"; ls -la "$tmp"
    exit 1
  fi
  [ -d build ] || cp -R "$tmp/ArgusDesk/build" ./build
  [ -f Taskfile.yml ] || cp "$tmp/ArgusDesk/Taskfile.yml" ./Taskfile.yml
fi

echo "프론트엔드 패키지를 받습니다"
(cd frontend && npm install)

cat <<'DONE'

준비가 끝났습니다.
  화면만 보기 (가짜 데이터):  cd frontend && npm run dev:mock
  앱 실행:                    wails3 dev
  테스트:                     go test ./internal/...
DONE
