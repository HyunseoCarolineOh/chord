import asyncio
import os
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from loguru import logger

# 개발 모드 여부
DEV_MODE = os.getenv("TRADING_MODE", "dev") == "dev"

if DEV_MODE:
    logger.warning("⚠️  개발 모드로 실행 (더미 데이터 사용)")
    from kiwoom.api_mock import MockKiwoomAPI as KiwoomAPI
else:
    logger.info("프로덕션 모드로 실행 (실제 키움 API)")
    from kiwoom.api import KiwoomAPI

from strategy.manager import StrategyManager

kiwoom = None
strategy_manager = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global kiwoom, strategy_manager

    logger.info("매매 서버 시작")
    kiwoom = KiwoomAPI()

    if not DEV_MODE:
        await kiwoom.connect()

    strategy_manager = StrategyManager(kiwoom)

    yield

    logger.info("매매 서버 종료")
    if kiwoom and not DEV_MODE:
        await kiwoom.disconnect()

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://localhost:\d+",  # 모든 localhost 포트 허용
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "kiwoom_connected": kiwoom.is_connected() if kiwoom else False
    }

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("WebSocket 클라이언트 연결")

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "get_account":
                # 계좌 정보 조회
                account_info = await kiwoom.get_account_info()
                await websocket.send_json({"type": "account", "payload": account_info})

            elif msg_type == "get_positions":
                # 보유 종목 조회
                positions = await kiwoom.get_positions()
                await websocket.send_json({"type": "positions", "payload": positions})

            elif msg_type == "set_config":
                # 자동매매 설정
                config = data.get("payload", {})
                if config.get("autoTrade"):
                    await strategy_manager.start({
                        "stop_loss_percent": config.get("stopLossRate", 3.0),
                        "take_profit_percent": config.get("takeProfitRate", 5.0),
                    })
                else:
                    await strategy_manager.stop()
                await websocket.send_json({"type": "config_updated", "payload": config})

            elif msg_type == "subscribe":
                # 실시간 호가/체결 구독
                code = data["code"]
                await kiwoom.subscribe_real(code)

    except WebSocketDisconnect:
        logger.info("WebSocket 클라이언트 연결 해제")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
