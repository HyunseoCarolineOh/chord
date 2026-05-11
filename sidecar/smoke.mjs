/**
 * 빠른 sidecar 스모크 테스트:
 *   - node dist/index.js를 spawn
 *   - ready 이벤트 + ping/pong 한 번
 *   - 1초 후 종료
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const child = spawn(process.execPath, ["dist/index.js"], { stdio: ["pipe", "pipe", "pipe"] });
const rl = createInterface({ input: child.stdout });

let received = 0;
rl.on("line", (line) => {
  console.log("OUT:", line);
  received++;
  if (received === 1) {
    // ready 받았음 — ping
    child.stdin.write(JSON.stringify({ id: "t1", type: "ping" }) + "\n");
  }
  if (received >= 2) {
    setTimeout(() => {
      child.stdin.end();
      child.kill();
      process.exit(0);
    }, 200);
  }
});

child.stderr.on("data", (d) => process.stderr.write("ERR: " + d.toString()));
setTimeout(() => {
  console.error("timeout — only got " + received + " lines");
  child.kill();
  process.exit(1);
}, 5000);
