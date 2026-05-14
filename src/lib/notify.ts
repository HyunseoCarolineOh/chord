// Windows/macOS/Linux 시스템 토스트 알림 헬퍼.
// 첫 호출 전 권한 확인/요청. 권한 거절되면 silently skip.
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

let permissionState: "unknown" | "granted" | "denied" = "unknown";

async function ensurePermission(): Promise<boolean> {
  if (permissionState === "granted") return true;
  if (permissionState === "denied") return false;
  try {
    const granted = await isPermissionGranted();
    if (granted) {
      permissionState = "granted";
      return true;
    }
    const result = await requestPermission();
    if (result === "granted") {
      permissionState = "granted";
      return true;
    }
    permissionState = "denied";
    return false;
  } catch (e) {
    console.error("notification permission check failed", e);
    return false;
  }
}

export async function notify(title: string, body: string): Promise<void> {
  if (!(await ensurePermission())) return;
  try {
    await sendNotification({ title, body });
  } catch (e) {
    console.error("sendNotification failed", e);
  }
}
