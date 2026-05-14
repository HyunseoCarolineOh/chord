import pandas as pd
import numpy as np
from backtesting import Backtest, Strategy
from loguru import logger

class AutoTradingStrategy(Strategy):
    stop_loss_pct = 3.0
    take_profit_pct = 5.0

    def init(self):
        pass

    def next(self):
        # 포지션이 없으면 진입 시그널 체크
        if not self.position:
            # TODO: 진입 조건 (이평선, RSI 등)
            if self._entry_signal():
                self.buy()
        else:
            # 손절/익절 체크
            entry_price = self.position.pl
            current_price = self.data.Close[-1]

            profit_pct = (current_price - entry_price) / entry_price * 100

            if profit_pct <= -self.stop_loss_pct:
                self.position.close()
                logger.info(f"손절: {profit_pct:.2f}%")

            elif profit_pct >= self.take_profit_pct:
                self.position.close()
                logger.info(f"익절: {profit_pct:.2f}%")

    def _entry_signal(self):
        # 간단한 예시: 5일 이평 > 20일 이평
        return True  # TODO: 실제 로직

def run_backtest(data: pd.DataFrame, stop_loss=3.0, take_profit=5.0):
    """백테스팅 실행"""

    bt = Backtest(
        data,
        AutoTradingStrategy,
        cash=10000000,
        commission=.0003,
    )

    stats = bt.run(
        stop_loss_pct=stop_loss,
        take_profit_pct=take_profit
    )

    logger.info(f"백테스팅 결과:\n{stats}")

    return stats, bt
