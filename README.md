# gung

브라우저에서 바로 접속해 즐길 수 있는 실시간 1대1 온라인 슈터입니다.

## 기능

- WebSocket 기반 실시간 1대1 매칭
- WASD 이동, 마우스 조준, 클릭 발사
- 5킬 선취 승리 룰
- Render 배포용 설정 포함
- Google AdSense 슬롯 준비 완료

## 실행

```bash
npm start
```

기본 주소는 `http://localhost:3000` 입니다.

## 광고 설정

Render 또는 로컬 환경변수에 `ADSENSE_CLIENT=ca-pub-...` 를 넣으면 광고 스크립트를 불러옵니다.

## 배포

[render.yaml](C:\Users\User\Downloads\orefall-idle\render.yaml)에 `gung` 서비스명으로 설정되어 있습니다.
