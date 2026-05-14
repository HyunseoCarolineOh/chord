"""개발용 Mock Kiwoom API (키움 OpenAPI 없이 테스트)"""
from loguru import logger
import asyncio


class MockKiwoomAPI:
    """키움 API 더미 구현 (로컬 개발용)"""

    def __init__(self):
        self.connected = True
        logger.info("✅ Mock Kiwoom API 초기화 (실제 연동 안 함)")

    async def connect(self):
        """연결 시뮬레이션"""
        await asyncio.sleep(0.1)
        self.connected = True
        logger.info("Mock: 키움 연결 시뮬레이션 완료")

    async def disconnect(self):
        """연결 해제 시뮬레이션"""
        self.connected = False
        logger.info("Mock: 연결 해제")

    def is_connected(self):
        return self.connected

    async def get_account_info(self):
        """더미 계좌 정보"""
        return {
            "accountNo": "8888888-01",
            "balance": 10000000,
            "availableCash": 5000000,
        }

    async def get_positions(self):
        """더미 보유 종목"""
        return [
            {
                "code": "005930",
                "name": "삼성전자",
                "qty": 10,
                "avgPrice": 70000,
                "currentPrice": 72000,
                "profitLoss": 20000,
                "profitLossRate": 2.86,
            },
            {
                "code": "035720",
                "name": "카카오",
                "qty": 5,
                "avgPrice": 50000,
                "currentPrice": 48000,
                "profitLoss": -10000,
                "profitLossRate": -4.0,
            },
        ]

    async def subscribe_real(self, code):
        """실시간 등록 시뮬레이션"""
        logger.info(f"Mock: 실시간 등록 시뮬레이션 - {code}")

    async def send_order(self, order_type, code, qty, price=0):
        """주문 시뮬레이션"""
        order_name = "매수" if order_type == 1 else "매도"
        price_type = "시장가" if price == 0 else f"{price}원"
        logger.info(f"Mock: {order_name} 주문 시뮬레이션 - {code} {qty}주 {price_type}")
        return True
