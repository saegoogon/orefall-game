# Orefall Idle Online

서버 저장, 리더보드, 토스페이먼츠 실결제 구조가 붙은 브라우저 방치형 광산 RPG입니다.

## 실행

1. 터미널에서 `C:\Users\User\Downloads\orefall-idle` 로 이동
2. `npm start`
3. 브라우저에서 `http://localhost:3000`

## Render 배포

1. Render에서 새 Blueprint 또는 Web Service 생성
2. 이 폴더를 Git 저장소로 올린 뒤 [render.yaml](C:\Users\User\Downloads\orefall-idle\render.yaml) 사용
3. Render 환경변수에 `TOSS_CLIENT_KEY`, `TOSS_SECRET_KEY` 입력
4. 배포 후 토스 개발자센터에 성공/실패 URL 도메인을 맞춰 등록

## 포함 기능

- 닉네임 기반 계정 생성과 로그인
- 서버 저장과 자동 동기화
- 리더보드
- 업그레이드, 연구소, 퀘스트, 보스 루프
- 프리미엄 젬과 스킨 상점
- 토스페이먼츠 실결제 승인 플로우

## 결제 설정

1. `.env.example`을 참고해서 프로젝트 루트에 `.env` 파일 생성
2. `TOSS_CLIENT_KEY`, `TOSS_SECRET_KEY` 입력
3. 테스트 키로 로컬에서 결제 승인 흐름 확인

## 결제 엔드포인트

- 결제 준비: `/api/store/checkout`
- 결제 승인: `/api/store/toss/confirm`
- 성공 페이지: `/payments/success`
- 실패 페이지: `/payments/fail`

## 보안 메모

- 세션은 `HttpOnly` 쿠키로 관리
- 상태 변경 API는 `CSRF` 헤더 검증
- 프리미엄 젬과 스킨은 서버 기준으로만 반영
- 보안 헤더와 `CSP` 적용
- Render 헬스체크용 `/healthz` 제공
