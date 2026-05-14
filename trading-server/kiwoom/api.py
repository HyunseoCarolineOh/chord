import sys
from PyQt5.QtWidgets import QApplication
from PyQt5.QAxContainer import QAxWidget
from PyQt5.QtCore import QEventLoop
from loguru import logger
import asyncio

class KiwoomAPI:
    def __init__(self):
        self.app = QApplication.instance()
        if self.app is None:
            self.app = QApplication(sys.argv)

        self.ocx = QAxWidget("KHOPENAPI.KHOpenAPICtrl.1")
        self.connected = False

        # 이벤트 핸들러 연결
        self.ocx.OnEventConnect.connect(self._on_event_connect)
        self.ocx.OnReceiveTrData.connect(self._on_receive_tr_data)
        self.ocx.OnReceiveRealData.connect(self._on_receive_real_data)
        self.ocx.OnReceiveChejanData.connect(self._on_receive_chejan_data)

        self.tr_data = {}
        self.real_callbacks = {}

    async def connect(self):
        """키움 OpenAPI 접속"""
        loop = QEventLoop()
        self.event_loop = loop

        ret = self.ocx.dynamicCall("CommConnect()")
        if ret == 0:
            logger.info("로그인 요청 성공")
            loop.exec_()
        else:
            logger.error(f"로그인 요청 실패: {ret}")

    def _on_event_connect(self, err_code):
        """로그인 결과 처리"""
        if err_code == 0:
            logger.info("키움 OpenAPI 접속 성공")
            self.connected = True
        else:
            logger.error(f"접속 실패: {err_code}")

        self.event_loop.exit()

    def _on_receive_tr_data(self, scr_no, rqname, trcode, record, next):
        """TR 데이터 수신"""
        logger.debug(f"TR 수신: {rqname} / {trcode}")

    def _on_receive_real_data(self, code, real_type, data):
        """실시간 데이터 수신"""
        if code in self.real_callbacks:
            callback = self.real_callbacks[code]
            callback(code, real_type, data)

    def _on_receive_chejan_data(self, gubun, item_cnt, fid_list):
        """체결/잔고 데이터 수신"""
        logger.info(f"체결 데이터: {gubun}")

    def is_connected(self):
        return self.connected

    async def subscribe_real(self, code):
        """실시간 호가/체결 등록"""
        fid_list = "10;11;12;27;28"  # 현재가, 전일대비, 등락률, 거래량 등
        self.ocx.dynamicCall("SetRealReg(QString, QString, QString, QString)",
                            "1000", code, fid_list, "0")
        logger.info(f"실시간 등록: {code}")

    async def send_order(self, order_type, code, qty, price=0):
        """주문 전송
        order_type: 1=매수, 2=매도
        price: 0=시장가
        """
        account = self.ocx.dynamicCall("GetLoginInfo(QString)", "ACCNO").split(';')[0]

        ret = self.ocx.dynamicCall(
            "SendOrder(QString, QString, QString, int, QString, int, int, QString, QString)",
            ["자동매매", "0101", account, order_type, code, qty, price, "03" if price == 0 else "00", ""]
        )

        if ret == 0:
            logger.info(f"주문 성공: {code} {qty}주")
        else:
            logger.error(f"주문 실패: {ret}")

        return ret == 0

    async def disconnect(self):
        """접속 해제"""
        self.ocx.dynamicCall("CommTerminate()")
        self.connected = False

    async def get_account_info(self):
        """계좌 정보 조회"""
        if not self.connected:
            return {
                "accountNo": "미연결",
                "balance": 0,
                "availableCash": 0,
            }

        account = self.ocx.dynamicCall("GetLoginInfo(QString)", "ACCNO").split(';')[0]

        # OPW00001: 예수금상세현황
        # 실제 구현에서는 TR 요청 후 응답 대기 필요
        # 여기서는 더미 데이터 반환
        return {
            "accountNo": account,
            "balance": 10000000,  # TODO: 실제 예수금 조회
            "availableCash": 5000000,
        }

    async def get_positions(self):
        """보유 종목 조회"""
        if not self.connected:
            return []

        # OPW00018: 계좌평가잔고내역요청
        # 실제 구현에서는 TR 요청 후 파싱 필요
        # 더미 데이터
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
