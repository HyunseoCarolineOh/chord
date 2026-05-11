// chord dev 시작 전 좀비 청소.
// - 이전 chord webview2 child (msedgewebview2.exe)
// - 이전 chord sidecar node 프로세스
// Windows 전용. 다른 OS면 no-op.
import { execSync } from "node:child_process";

if (process.platform !== "win32") {
  console.log("[chord cleanup] non-windows, skip");
  process.exit(0);
}

function ps(cmd) {
  try {
    return execSync(`powershell -NoProfile -Command "${cmd.replace(/"/g, '\\"')}"`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

// 1. chord webview2 자손
const webviewOut = ps(
  `Get-CimInstance Win32_Process -Filter \\"Name='msedgewebview2.exe'\\" | ` +
    `Where-Object { $_.CommandLine -like '*chord*' -or $_.CommandLine -like '*com.chord*' } | ` +
    `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId } | ` +
    `Measure-Object | Select-Object -ExpandProperty Count`,
);
const webviewKilled = parseInt(webviewOut.trim() || "0", 10);

// 2. chord sidecar node
const sidecarOut = ps(
  `Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | ` +
    `Where-Object { $_.CommandLine -like '*chord*sidecar*' -or $_.CommandLine -like '*sidecar*index.js*' } | ` +
    `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId } | ` +
    `Measure-Object | Select-Object -ExpandProperty Count`,
);
const sidecarKilled = parseInt(sidecarOut.trim() || "0", 10);

// 3. 1420 포트 잡고 있는 프로세스 (이전 dev vite)
const portOut = ps(
  `Get-NetTCPConnection -State Listen -LocalPort 1420 -ErrorAction SilentlyContinue | ` +
    `ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue; $_.OwningProcess } | ` +
    `Measure-Object | Select-Object -ExpandProperty Count`,
);
const portKilled = parseInt(portOut.trim() || "0", 10);

console.log(
  `[chord cleanup] webview=${webviewKilled} sidecar=${sidecarKilled} port-1420=${portKilled}`,
);
