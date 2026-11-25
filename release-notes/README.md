# 릴리스 노트

`v<버전>.md` 파일이 그 버전의 GitHub Release 본문이 되고, 업데이트 후 앱에서 한 번 보여줍니다.

릴리스 순서:

1. `version.go`의 `Version`을 올립니다.
2. `release-notes/v<버전>.md`를 씁니다. 실제 티켓 내용이나 사내 이름은 적지 않습니다.
3. 커밋한 뒤 `git tag v<버전> && git push origin v<버전>`.

태그와 `version.go`가 다르면 빌드가 실패합니다.
