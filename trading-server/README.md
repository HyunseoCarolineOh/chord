# 자동매매 서버

키움증권 OpenAPI 기반 자동매매 백엔드

## 설치

```bash
cd trading-server
pip install -r requirements.txt
```

> ⚠️ **TA-Lib 설치 주의**  
> Windows: https://www.lfd.uci.edu/~gohlke/pythonlibs/#ta-lib 에서 .whl 다운로드 후 설치  
> `pip install TA_Lib-0.4.32-cp312-cp312-win_amd64.whl`

## 설정

`.env.example`을 `.env`로 복사 후 계좌 정보 입력

```bash
cp .env.example .env
```

## 실행

```bash
python main.py
```

서버: http://localhost:8001  
WebSocket: ws://localhost:8001/ws

## 구조

```
trading-server/
├─ main.py              FastAPI 서버
├─ kiwoom/
│  └─ api.py           키움 OpenAPI 래퍼
├─ strategy/
│  └─ manager.py       매매 전략 관리
└─ backtest/
   └─ engine.py        백테스팅 엔진
```
