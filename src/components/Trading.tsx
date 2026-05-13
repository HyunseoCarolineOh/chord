import { useState, useEffect } from "react";

type ConnectionStatus = "disconnected" | "connecting" | "connected";

type Account = {
  accountNo: string;
  balance: number;
  availableCash: number;
};

type Position = {
  code: string;
  name: string;
  qty: number;
  avgPrice: number;
  currentPrice: number;
  profitLoss: number;
  profitLossRate: number;
};

type TradingConfig = {
  autoTrade: boolean;
  stopLossRate: number;
  takeProfitRate: number;
};

export function Trading() {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [account, setAccount] = useState<Account | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [config, setConfig] = useState<TradingConfig>({
    autoTrade: false,
    stopLossRate: 3.0,
    takeProfitRate: 5.0,
  });
  const [ws, setWs] = useState<WebSocket | null>(null);

  // WebSocket 연결
  useEffect(() => {
    if (status === "connecting") {
      const socket = new WebSocket("ws://localhost:8000/ws");

      socket.onopen = () => {
        console.log("Trading server connected");
        setStatus("connected");
        socket.send(JSON.stringify({ type: "get_account" }));
        socket.send(JSON.stringify({ type: "get_positions" }));
      };

      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleServerMessage(data);
      };

      socket.onerror = (error) => {
        console.error("WebSocket error:", error);
        setStatus("disconnected");
      };

      socket.onclose = () => {
        console.log("Trading server disconnected");
        setStatus("disconnected");
      };

      setWs(socket);

      return () => {
        socket.close();
      };
    }
  }, [status]);

  function handleServerMessage(data: any) {
    switch (data.type) {
      case "account":
        setAccount(data.payload);
        break;
      case "positions":
        setPositions(data.payload);
        break;
      case "price_update":
        updatePositionPrice(data.payload.code, data.payload.price);
        break;
    }
  }

  function updatePositionPrice(code: string, price: number) {
    setPositions((prev) =>
      prev.map((p) => {
        if (p.code === code) {
          const profitLoss = (price - p.avgPrice) * p.qty;
          const profitLossRate = ((price - p.avgPrice) / p.avgPrice) * 100;
          return { ...p, currentPrice: price, profitLoss, profitLossRate };
        }
        return p;
      }),
    );
  }

  function handleConnect() {
    setStatus("connecting");
  }

  function handleDisconnect() {
    ws?.close();
    setStatus("disconnected");
  }

  function toggleAutoTrade() {
    const newConfig = { ...config, autoTrade: !config.autoTrade };
    setConfig(newConfig);
    ws?.send(JSON.stringify({ type: "set_config", payload: newConfig }));
  }

  function updateStopLoss(rate: number) {
    const newConfig = { ...config, stopLossRate: rate };
    setConfig(newConfig);
    ws?.send(JSON.stringify({ type: "set_config", payload: newConfig }));
  }

  function updateTakeProfit(rate: number) {
    const newConfig = { ...config, takeProfitRate: rate };
    setConfig(newConfig);
    ws?.send(JSON.stringify({ type: "set_config", payload: newConfig }));
  }

  return (
    <div className="trading-panel">
      {/* 연결 상태 */}
      <div className="trading-section">
        <div className="section-label">서버 연결</div>
        <div className="connection-status">
          <span className={`status-indicator ${status}`}></span>
          <span className="status-text">{status}</span>
        </div>
        {status === "disconnected" && (
          <button className="btn-connect" onClick={handleConnect}>
            연결
          </button>
        )}
        {status === "connected" && (
          <button className="btn-disconnect" onClick={handleDisconnect}>
            연결 해제
          </button>
        )}
      </div>

      {/* 계좌 정보 */}
      {account && (
        <div className="trading-section">
          <div className="section-label">계좌</div>
          <div className="account-info">
            <div className="account-row">
              <span className="label">계좌번호</span>
              <span className="value">{account.accountNo}</span>
            </div>
            <div className="account-row">
              <span className="label">평가금액</span>
              <span className="value">{account.balance.toLocaleString()}원</span>
            </div>
            <div className="account-row">
              <span className="label">예수금</span>
              <span className="value">{account.availableCash.toLocaleString()}원</span>
            </div>
          </div>
        </div>
      )}

      {/* 자동매매 설정 */}
      <div className="trading-section">
        <div className="section-label">자동매매</div>
        <div className="auto-trade-toggle">
          <button
            className={`toggle-btn ${config.autoTrade ? "active" : ""}`}
            onClick={toggleAutoTrade}
          >
            {config.autoTrade ? "ON" : "OFF"}
          </button>
        </div>
        <div className="trade-config">
          <div className="config-row">
            <label>손절률 (%)</label>
            <input
              type="number"
              step="0.1"
              value={config.stopLossRate}
              onChange={(e) => updateStopLoss(parseFloat(e.target.value))}
            />
          </div>
          <div className="config-row">
            <label>익절률 (%)</label>
            <input
              type="number"
              step="0.1"
              value={config.takeProfitRate}
              onChange={(e) => updateTakeProfit(parseFloat(e.target.value))}
            />
          </div>
        </div>
      </div>

      {/* 보유 종목 */}
      {positions.length > 0 && (
        <div className="trading-section">
          <div className="section-label">보유 종목</div>
          <div className="positions-list">
            {positions.map((p) => (
              <div key={p.code} className="position-item">
                <div className="position-header">
                  <span className="stock-name">{p.name}</span>
                  <span className="stock-code">{p.code}</span>
                </div>
                <div className="position-info">
                  <div className="info-row">
                    <span className="label">수량</span>
                    <span className="value">{p.qty}</span>
                  </div>
                  <div className="info-row">
                    <span className="label">평균가</span>
                    <span className="value">{p.avgPrice.toLocaleString()}</span>
                  </div>
                  <div className="info-row">
                    <span className="label">현재가</span>
                    <span className="value">{p.currentPrice.toLocaleString()}</span>
                  </div>
                  <div className="info-row profit-loss">
                    <span className="label">손익</span>
                    <span className={`value ${p.profitLoss >= 0 ? "profit" : "loss"}`}>
                      {p.profitLoss >= 0 ? "+" : ""}
                      {p.profitLoss.toLocaleString()}원 ({p.profitLossRate.toFixed(2)}%)
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
