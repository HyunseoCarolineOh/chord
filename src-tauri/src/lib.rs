// chord — Tauri 코어. sidecar / fs / git 모듈을 묶는 entry.
mod sidecar;
mod fs_ops;
mod git_ops;

use tauri::{Emitter, Manager, RunEvent, State, WindowEvent};
use sidecar::{SidecarState, sidecar_send, spawn_sidecar};
use fs_ops::{fs_list, fs_read, fs_write, fs_move, fs_read_abs, fs_write_abs, fs_home_dir, fs_exists_abs};
use git_ops::{
    git_status, git_diff, git_branches, git_checkout, git_log, git_sync,
    git_stash_save, git_stash_list, git_stash_pop, git_stash_drop,
    git_rebase_status, git_rebase_start, git_rebase_continue, git_rebase_abort,
    git_conflicts,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(SidecarState::new())
        .setup(|app| {
            let handle = app.handle().clone();
            let state: State<'_, SidecarState> = app.state();
            match spawn_sidecar(&handle) {
                Ok((child, stdin)) => {
                    *state.stdin.lock().unwrap() = Some(stdin);
                    *state.child.lock().unwrap() = Some(child);
                }
                Err(e) => {
                    eprintln!("[chord] sidecar spawn 실패: {e}");
                    let _ = handle.emit("sidecar:error", e);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            sidecar_send,
            fs_list,
            fs_read,
            fs_write,
            fs_move,
            fs_read_abs,
            fs_write_abs,
            fs_home_dir,
            fs_exists_abs,
            git_status,
            git_diff,
            git_branches,
            git_checkout,
            git_log,
            git_sync,
            git_stash_save,
            git_stash_list,
            git_stash_pop,
            git_stash_drop,
            git_rebase_status,
            git_rebase_start,
            git_rebase_continue,
            git_rebase_abort,
            git_conflicts,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            match event {
                // 윈도우 닫힘 → sidecar kill
                RunEvent::WindowEvent { event: WindowEvent::CloseRequested { .. }, .. } => {
                    if let Some(state) = app.try_state::<SidecarState>() {
                        state.kill();
                    }
                }
                // 앱 종료 직전 → sidecar kill (윈도우 close 이벤트 누락 보강)
                RunEvent::ExitRequested { .. } | RunEvent::Exit => {
                    if let Some(state) = app.try_state::<SidecarState>() {
                        state.kill();
                    }
                }
                _ => {}
            }
        });
}
