from loguru import logger
from typing import Dict, Any
import asyncio

class StrategyManager:
    def __init__(self, kiwoom):
        self.kiwoom = kiwoom
        self.running = False
        self.config = {}
        self.positions = {}  # {종목코드: {qty, avg_price, stop_loss, take_profit}}

    async def start(self, config: Dict[str, Any]):
        """자동매매 시작"""
        self.config = config
        self.running = True

        stop_loss = config.get("stop_loss_percent", 3.0)
        take_profit = config.get("take_profit_percent", 5.0)

        logger.info(f"자동매매 시작 - 손절: {stop_loss}%, 익절: {take_profit}%")

        # 실시간 모니터링 루프 시작
        asyncio.create_task(self._monitor_loop())

    async def stop(self):
        """자동매매 중지"""
        self.running = False
        logger.info("자동매매 중지")

    async def _monitor_loop(self):
        """실시간 가격 모니터링 & 손익절 체크"""
        while self.running:
            for code, position in self.positions.items():
                current_price = await self._get_current_price(code)

                if current_price:
                    profit_rate = (current_price - position["avg_price"]) / position["avg_price"] * 100

                    # 손절
                    if profit_rate <= -self.config["stop_loss_percent"]:
                        logger.warning(f"{code} 손절 실행: {profit_rate:.2f}%")
                        await self.kiwoom.send_order(2, code, position["qty"])
                        del self.positions[code]

                    # 익절
                    elif profit_rate >= self.config["take_profit_percent"]:
                        logger.info(f"{code} 익절 실행: {profit_rate:.2f}%")
                        await self.kiwoom.send_order(2, code, position["qty"])
                        del self.positions[code]

            await asyncio.sleep(1)

    async def _get_current_price(self, code):
        """현재가 조회 (실시간 데이터에서)"""
        # TODO: 실시간 데이터 캐시에서 가져오기
        return None

    def add_position(self, code, qty, price):
        """포지션 추가"""
        self.positions[code] = {
            "qty": qty,
            "avg_price": price,
        }
        logger.info(f"포지션 추가: {code} {qty}주 @{price}")
