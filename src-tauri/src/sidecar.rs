// sidecar Node 프로세스 spawn + JSONL stdin/stdout 중계
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

pub struct SidecarState {
    pub stdin: Mutex<Option<ChildStdin>>,
    pub child: Mutex<Option<Child>>,
}

impl SidecarState {
    pub fn new() -> Self {
        Self {
            stdin: Mutex::new(None),
            child: Mutex::new(None),
        }
    }

    /// 명시적 정리 — chord 앱이 윈도우 닫힐 때 호출. sidecar node process를 강제 종료.
    pub fn kill(&self) {
        // stdin 먼저 drop → sidecar의 readline 'close' 트리거 → 자체 종료 시도
        if let Ok(mut guard) = self.stdin.lock() {
            *guard = None;
        }
        // 그래도 살아있으면 강제 kill
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

#[tauri::command]
pub fn sidecar_send(state: State<'_, SidecarState>, line: String) -> Result<(), String> {
    let mut guard = state.stdin.lock().map_err(|e| e.to_string())?;
    let stdin = guard.as_mut().ok_or("sidecar not started")?;
    let payload = if line.ends_with('\n') { line } else { format!("{line}\n") };
    stdin.write_all(payload.as_bytes()).map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn spawn_sidecar(app: &AppHandle) -> Result<(Child, ChildStdin), String> {
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    let sidecar_root = cwd
        .parent()
        .map(|p| p.join("sidecar"))
        .unwrap_or_else(|| cwd.join("sidecar"));
    let entry = sidecar_root.join("dist").join("index.js");
    if !entry.exists() {
        return Err(format!("sidecar entry not found: {}", entry.display()));
    }

    let mut cmd = Command::new("node");
    cmd.arg(&entry)
        .current_dir(&sidecar_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|e| format!("node spawn 실패: {e}"))?;
    let stdin = child.stdin.take().ok_or("no stdin handle")?;
    let stdout = child.stdout.take().ok_or("no stdout handle")?;
    let stderr = child.stderr.take().ok_or("no stderr handle")?;

    {
        let app = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(l) => {
                        let _ = app.emit("sidecar:line", l);
                    }
                    Err(_) => break,
                }
            }
            let _ = app.emit("sidecar:closed", ());
        });
    }
    {
        let app = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(l) = line {
                    let _ = app.emit("sidecar:stderr", l);
                }
            }
        });
    }

    Ok((child, stdin))
}
