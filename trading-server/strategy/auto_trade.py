from typing import Dict
import asyncio
from kiwoom.api import KiwoomAPI


class AutoTradeStrategy:
    def __init__(self, kiwoom: KiwoomAPI):
        self.kiwoom = kiwoom
        self.config = {
            "autoTrade": False,
            "stopLossRate": 3.0,
            "takeProfitRate": 5.0,
        }
        self.running = False
        self.task = None

    def update_config(self, config: Dict):
        """설정 업데이트"""
        self.config.update(config)
        print(f"Strategy config updated: {self.config}")

    async def start(self):
        """자동매매 시작"""
        if self.running:
            return

        self.running = True
        print("Auto trade started")
        self.task = asyncio.create_task(self._trade_loop())

    def stop(self):
        """자동매매 중지"""
        self.running = False
        if self.task:
            self.task.cancel()
        print("Auto trade stopped")

    async def _trade_loop(self):
        """매매 루프"""
        while self.running:
            try:
                positions = self.kiwoom.get_positions()

                for pos in positions:
                    # 손절 체크
                    if pos["profitLossRate"] <= -self.config["stopLossRate"]:
                        print(f"Stop loss triggered: {pos['name']} ({pos['profitLossRate']:.2f}%)")
                        self.kiwoom.sell(pos["code"], pos["qty"], pos["currentPrice"])

                    # 익절 체크
                    elif pos["profitLossRate"] >= self.config["takeProfitRate"]:
                        print(f"Take profit triggered: {pos['name']} ({pos['profitLossRate']:.2f}%)")
                        self.kiwoom.sell(pos["code"], pos["qty"], pos["currentPrice"])

                await asyncio.sleep(1)  # 1초마다 체크

            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"Trade loop error: {e}")
                await asyncio.sleep(5)
