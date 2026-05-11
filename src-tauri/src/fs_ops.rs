// 파일 시스템 commands — workspace.root_path 기준 상대경로로 안전하게.
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,    // root 기준 상대경로 (forward slashes)
    pub is_dir: bool,
    pub size: u64,
}

fn resolve(root: &str, rel: &str) -> Result<PathBuf, String> {
    let root_p = Path::new(root);
    if !root_p.is_absolute() {
        return Err("root must be absolute".into());
    }
    // 상대경로 .. 차단
    let trimmed = rel.trim_start_matches(['/', '\\']);
    if trimmed.split(['/', '\\']).any(|seg| seg == "..") {
        return Err("'..' segments not allowed".into());
    }
    Ok(root_p.join(trimmed))
}

fn to_rel(root: &str, full: &Path) -> String {
    let root_p = Path::new(root);
    full.strip_prefix(root_p)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| full.to_string_lossy().to_string())
}

#[tauri::command]
pub fn fs_list(root: String, rel: String) -> Result<Vec<DirEntry>, String> {
    let dir = resolve(&root, &rel)?;
    let mut out = Vec::new();
    let read = fs::read_dir(&dir).map_err(|e| format!("{}: {}", dir.display(), e))?;
    for entry in read.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        // .git, node_modules, target, dist 같은 흔한 노이즈 숨김
        if matches!(name.as_str(), ".git" | "node_modules" | "target" | "dist" | ".next" | ".cache") {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let path = to_rel(&root, &entry.path());
        out.push(DirEntry {
            name,
            path,
            is_dir: meta.is_dir(),
            size: if meta.is_file() { meta.len() } else { 0 },
        });
    }
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}

#[tauri::command]
pub fn fs_read(root: String, rel: String) -> Result<String, String> {
    let p = resolve(&root, &rel)?;
    fs::read_to_string(&p).map_err(|e| format!("{}: {}", p.display(), e))
}

#[tauri::command]
pub fn fs_write(root: String, rel: String, content: String) -> Result<(), String> {
    let p = resolve(&root, &rel)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("{}: {}", parent.display(), e))?;
    }
    fs::write(&p, content).map_err(|e| format!("{}: {}", p.display(), e))?;
    Ok(())
}

#[tauri::command]
pub fn fs_move(root: String, from_rel: String, to_rel: String) -> Result<(), String> {
    let from = resolve(&root, &from_rel)?;
    let to = resolve(&root, &to_rel)?;
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("{}: {}", parent.display(), e))?;
    }
    fs::rename(&from, &to).map_err(|e| format!("{} → {}: {}", from.display(), to.display(), e))?;
    Ok(())
}

/// 절대 경로 읽기 — 글로벌 ~/.claude/agents 같은 root 외부 파일용.
#[tauri::command]
pub fn fs_read_abs(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    if !p.is_absolute() {
        return Err("must be absolute path".into());
    }
    fs::read_to_string(p).map_err(|e| format!("{}: {}", p.display(), e))
}

#[tauri::command]
pub fn fs_write_abs(path: String, content: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.is_absolute() {
        return Err("must be absolute path".into());
    }
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("{}: {}", parent.display(), e))?;
    }
    fs::write(p, content).map_err(|e| format!("{}: {}", p.display(), e))?;
    Ok(())
}

#[tauri::command]
pub fn fs_home_dir() -> Result<String, String> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(|p| p.replace('\\', "/"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_exists_abs(path: String) -> Result<bool, String> {
    Ok(Path::new(&path).exists())
}
