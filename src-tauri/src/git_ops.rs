// Git commands — git2 (libgit2) 기반.
// 커밋과 푸시는 분리하지 않고 git_sync 한 번에.
use git2::{
    BranchType, DiffOptions, IndexAddOption, ObjectType, PushOptions, RebaseOptions,
    RemoteCallbacks, Repository, Signature, StashFlags, StatusOptions,
};
use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
pub struct StatusEntry {
    pub path: String,
    pub status: String,  // "modified" | "added" | "deleted" | "untracked" | "renamed" | "conflicted"
    pub staged: bool,
}

#[derive(Serialize)]
pub struct GitStatus {
    pub branch: String,
    pub ahead: usize,
    pub behind: usize,
    pub entries: Vec<StatusEntry>,
}

#[derive(Serialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
    pub upstream: Option<String>,
}

#[derive(Serialize)]
pub struct LogEntry {
    pub sha: String,
    pub short_sha: String,
    pub author: String,
    pub email: String,
    pub message: String,
    pub time: i64,  // unix seconds
}

fn open_repo(root: &str) -> Result<Repository, String> {
    Repository::open(Path::new(root)).map_err(|e| format!("git open: {e}"))
}

#[tauri::command]
pub fn git_status(root: String) -> Result<GitStatus, String> {
    let repo = open_repo(&root)?;

    // branch + ahead/behind
    let head = repo.head().ok();
    let branch = head
        .as_ref()
        .and_then(|h| h.shorthand().map(String::from))
        .unwrap_or_else(|| "(detached)".into());

    let (mut ahead, mut behind) = (0usize, 0usize);
    if let Some(h) = head.as_ref() {
        if let Some(local_oid) = h.target() {
            if let Ok(branch_ref) = repo.find_branch(&branch, BranchType::Local) {
                if let Ok(upstream) = branch_ref.upstream() {
                    if let Some(u_oid) = upstream.get().target() {
                        if let Ok(c) = repo.graph_ahead_behind(local_oid, u_oid) {
                            ahead = c.0;
                            behind = c.1;
                        }
                    }
                }
            }
        }
    }

    let mut so = StatusOptions::new();
    so.include_untracked(true).recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut so)).map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    for s in statuses.iter() {
        let bits = s.status();
        let path = s.path().unwrap_or("").to_string();
        // 한 entry는 staged + workdir 둘 다 가질 수 있지만 단순화: workdir 우선.
        let (status, staged) = classify(bits);
        if status.is_empty() {
            continue;
        }
        entries.push(StatusEntry { path, status, staged });
    }

    Ok(GitStatus { branch, ahead, behind, entries })
}

fn classify(bits: git2::Status) -> (String, bool) {
    use git2::Status as S;
    if bits.contains(S::CONFLICTED) {
        return ("conflicted".into(), false);
    }
    if bits.intersects(S::INDEX_NEW | S::INDEX_MODIFIED | S::INDEX_DELETED | S::INDEX_RENAMED) {
        let kind = if bits.contains(S::INDEX_NEW) {
            "added"
        } else if bits.contains(S::INDEX_DELETED) {
            "deleted"
        } else if bits.contains(S::INDEX_RENAMED) {
            "renamed"
        } else {
            "modified"
        };
        return (kind.into(), true);
    }
    if bits.contains(S::WT_NEW) {
        return ("untracked".into(), false);
    }
    if bits.contains(S::WT_MODIFIED) {
        return ("modified".into(), false);
    }
    if bits.contains(S::WT_DELETED) {
        return ("deleted".into(), false);
    }
    if bits.contains(S::WT_RENAMED) {
        return ("renamed".into(), false);
    }
    ("".into(), false)
}

#[tauri::command]
pub fn git_diff(root: String, rel_path: String) -> Result<String, String> {
    let repo = open_repo(&root)?;
    let mut opts = DiffOptions::new();
    opts.pathspec(&rel_path);
    opts.context_lines(3);

    // workdir vs index (스테이지 안 된 변경) — 단순화: workdir vs HEAD.
    let head_tree = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_tree().ok());

    let diff = if let Some(tree) = head_tree {
        repo.diff_tree_to_workdir_with_index(Some(&tree), Some(&mut opts))
    } else {
        repo.diff_index_to_workdir(None, Some(&mut opts))
    }
    .map_err(|e| e.to_string())?;

    let mut out = String::new();
    diff.print(git2::DiffFormat::Patch, |_d, _h, line| {
        let prefix = match line.origin() {
            '+' | '-' | ' ' => line.origin().to_string(),
            _ => String::new(),
        };
        out.push_str(&prefix);
        out.push_str(std::str::from_utf8(line.content()).unwrap_or(""));
        true
    })
    .map_err(|e| e.to_string())?;

    Ok(out)
}

#[tauri::command]
pub fn git_branches(root: String) -> Result<Vec<BranchInfo>, String> {
    let repo = open_repo(&root)?;
    let head = repo.head().ok();
    let head_name = head.as_ref().and_then(|h| h.shorthand().map(String::from));

    let mut out = Vec::new();
    let branches = repo.branches(Some(BranchType::Local)).map_err(|e| e.to_string())?;
    for b in branches.flatten() {
        let (br, _) = b;
        let name = br
            .name()
            .ok()
            .flatten()
            .map(String::from)
            .unwrap_or_default();
        if name.is_empty() {
            continue;
        }
        let upstream = br
            .upstream()
            .ok()
            .and_then(|u| u.name().ok().flatten().map(String::from));
        let is_current = head_name.as_deref() == Some(name.as_str());
        out.push(BranchInfo { name, is_current, upstream });
    }
    out.sort_by(|a, b| match (a.is_current, b.is_current) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });
    Ok(out)
}

#[tauri::command]
pub fn git_checkout(root: String, branch: String) -> Result<(), String> {
    let repo = open_repo(&root)?;
    let (object, reference) = repo
        .revparse_ext(&branch)
        .map_err(|e| format!("revparse {branch}: {e}"))?;
    repo.checkout_tree(&object, None).map_err(|e| e.to_string())?;
    match reference {
        Some(gref) => repo.set_head(gref.name().unwrap_or(&branch)),
        None => repo.set_head_detached(object.id()),
    }
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn git_log(root: String, limit: Option<usize>) -> Result<Vec<LogEntry>, String> {
    let repo = open_repo(&root)?;
    let mut walk = repo.revwalk().map_err(|e| e.to_string())?;
    walk.push_head().map_err(|e| e.to_string())?;
    let lim = limit.unwrap_or(50);
    let mut out = Vec::new();
    for oid in walk.flatten().take(lim) {
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
        let sha = oid.to_string();
        let short_sha = sha.chars().take(8).collect();
        let author = commit.author();
        out.push(LogEntry {
            sha,
            short_sha,
            author: author.name().unwrap_or("").to_string(),
            email: author.email().unwrap_or("").to_string(),
            message: commit.message().unwrap_or("").to_string(),
            time: commit.time().seconds(),
        });
    }
    Ok(out)
}

/// stage 선택된 path들 → commit (메시지) → push (현재 branch 추적 upstream).
/// `paths`가 비어 있으면 모든 변경 stage. `message`가 비어 있으면 자동 생성.
#[tauri::command]
pub fn git_sync(
    root: String,
    paths: Vec<String>,
    message: String,
) -> Result<String, String> {
    let repo = open_repo(&root)?;

    // 1. stage
    let mut index = repo.index().map_err(|e| e.to_string())?;
    if paths.is_empty() {
        index
            .add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
            .map_err(|e| format!("stage all: {e}"))?;
    } else {
        for p in &paths {
            index
                .add_all([p].iter(), IndexAddOption::DEFAULT, None)
                .map_err(|e| format!("stage {p}: {e}"))?;
        }
    }
    index.write().map_err(|e| e.to_string())?;

    // 2. commit
    let tree_oid = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_oid).map_err(|e| e.to_string())?;
    let parent = repo
        .head()
        .ok()
        .and_then(|h| h.peel(ObjectType::Commit).ok())
        .and_then(|o| o.into_commit().ok());
    let parents: Vec<&git2::Commit> = parent.iter().collect();

    let sig = repo
        .signature()
        .or_else(|_| Signature::now("chord", "chord@local"))
        .map_err(|e| e.to_string())?;

    let final_msg = if message.trim().is_empty() {
        if paths.is_empty() {
            "chore: chord sync".to_string()
        } else if paths.len() == 1 {
            format!("chore: update {}", paths[0])
        } else {
            format!("chore: update {} files", paths.len())
        }
    } else {
        message
    };

    let commit_oid = repo
        .commit(Some("HEAD"), &sig, &sig, &final_msg, &tree, &parents)
        .map_err(|e| format!("commit: {e}"))?;

    // 3. push
    let head = repo.head().map_err(|e| e.to_string())?;
    let branch_name = head
        .shorthand()
        .ok_or("could not resolve current branch")?
        .to_string();
    let refspec = format!("refs/heads/{branch_name}:refs/heads/{branch_name}");

    // 원격: 현재 branch의 upstream에서 추출, 없으면 'origin'
    let remote_name = {
        let buf = repo.branch_upstream_remote(&format!("refs/heads/{branch_name}")).ok();
        buf.and_then(|b| b.as_str().map(String::from)).unwrap_or_else(|| "origin".into())
    };
    let mut remote = repo
        .find_remote(&remote_name)
        .map_err(|e| format!("find remote {remote_name}: {e}"))?;

    // SSH/HTTPS auth: SSH는 ssh-agent, HTTPS는 credential helper.
    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(|url, username_from_url, allowed_types| {
        if allowed_types.contains(git2::CredentialType::SSH_KEY) {
            return git2::Cred::ssh_key_from_agent(username_from_url.unwrap_or("git"));
        }
        if allowed_types.contains(git2::CredentialType::USER_PASS_PLAINTEXT) {
            return git2::Cred::credential_helper(&git2::Config::open_default()?, url, username_from_url);
        }
        Err(git2::Error::from_str("no supported auth method"))
    });
    let mut po = PushOptions::new();
    po.remote_callbacks(callbacks);

    remote
        .push(&[refspec.as_str()], Some(&mut po))
        .map_err(|e| format!("push: {e}"))?;

    Ok(commit_oid.to_string())
}

#[derive(Serialize)]
pub struct StashEntry {
    pub index: usize,
    pub message: String,
    pub oid: String,
}

#[tauri::command]
pub fn git_stash_save(root: String, message: String) -> Result<String, String> {
    let mut repo = open_repo(&root)?;
    let sig = repo
        .signature()
        .or_else(|_| Signature::now("chord", "chord@local"))
        .map_err(|e| e.to_string())?;
    let msg = if message.trim().is_empty() {
        "chord stash"
    } else {
        message.trim()
    };
    let oid = repo
        .stash_save(&sig, msg, Some(StashFlags::INCLUDE_UNTRACKED))
        .map_err(|e| format!("stash: {e}"))?;
    Ok(oid.to_string())
}

#[tauri::command]
pub fn git_stash_list(root: String) -> Result<Vec<StashEntry>, String> {
    let mut repo = open_repo(&root)?;
    let mut out = Vec::new();
    repo.stash_foreach(|index, message, oid| {
        out.push(StashEntry {
            index,
            message: message.to_string(),
            oid: oid.to_string(),
        });
        true
    })
    .map_err(|e| e.to_string())?;
    Ok(out)
}

#[tauri::command]
pub fn git_stash_pop(root: String, index: usize) -> Result<(), String> {
    let mut repo = open_repo(&root)?;
    repo.stash_pop(index, None).map_err(|e| format!("pop: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn git_stash_drop(root: String, index: usize) -> Result<(), String> {
    let mut repo = open_repo(&root)?;
    repo.stash_drop(index).map_err(|e| format!("drop: {e}"))?;
    Ok(())
}

#[derive(Serialize)]
pub struct RebaseStatus {
    pub in_progress: bool,
    pub current: Option<usize>,
    pub total: usize,
    pub conflicted_paths: Vec<String>,
}

fn collect_conflicts(repo: &Repository) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(mut index) = repo.index() {
        for c in index.conflicts().into_iter().flatten().flatten() {
            if let Some(our) = c.our.as_ref() {
                let p = std::str::from_utf8(&our.path).unwrap_or("").to_string();
                if !p.is_empty() && !out.contains(&p) {
                    out.push(p);
                }
            }
        }
    }
    out
}

#[tauri::command]
pub fn git_rebase_status(root: String) -> Result<RebaseStatus, String> {
    let repo = open_repo(&root)?;
    let mut opts = RebaseOptions::new();
    let in_progress = repo.open_rebase(Some(&mut opts)).is_ok();
    let mut current = None;
    let mut total = 0;
    if let Ok(mut rebase) = repo.open_rebase(None) {
        current = Some(rebase.operation_current().unwrap_or(0));
        total = rebase.len();
    }
    Ok(RebaseStatus {
        in_progress,
        current,
        total,
        conflicted_paths: collect_conflicts(&repo),
    })
}

/// 현재 branch를 `onto` 위로 rebase. 충돌 시 함수가 끝나도 작업트리에 conflict markers 남고
/// rebase는 진행 중 상태로 보존됨. resolve 후 git_rebase_continue.
#[tauri::command]
pub fn git_rebase_start(root: String, onto: String) -> Result<RebaseStatus, String> {
    let repo = open_repo(&root)?;
    let upstream = repo
        .revparse_single(&onto)
        .and_then(|o| repo.find_annotated_commit(o.id()))
        .map_err(|e| format!("revparse {onto}: {e}"))?;
    let mut rebase = repo
        .rebase(None, Some(&upstream), None, None)
        .map_err(|e| format!("rebase init: {e}"))?;

    let sig = repo
        .signature()
        .or_else(|_| Signature::now("chord", "chord@local"))
        .map_err(|e| e.to_string())?;

    while rebase.next().is_some() {
        if !collect_conflicts(&repo).is_empty() {
            return Ok(RebaseStatus {
                in_progress: true,
                current: rebase.operation_current(),
                total: rebase.len(),
                conflicted_paths: collect_conflicts(&repo),
            });
        }
        if let Err(e) = rebase.commit(None, &sig, None) {
            return Err(format!("rebase commit: {e}"));
        }
    }
    rebase.finish(Some(&sig)).map_err(|e| e.to_string())?;
    Ok(RebaseStatus { in_progress: false, current: None, total: 0, conflicted_paths: vec![] })
}

#[tauri::command]
pub fn git_rebase_continue(root: String) -> Result<RebaseStatus, String> {
    let repo = open_repo(&root)?;
    let mut rebase = repo.open_rebase(None).map_err(|e| e.to_string())?;
    let sig = repo
        .signature()
        .or_else(|_| Signature::now("chord", "chord@local"))
        .map_err(|e| e.to_string())?;

    // index에 충돌 남아있으면 abort
    if !collect_conflicts(&repo).is_empty() {
        return Err("아직 conflict가 남아있습니다. 충돌을 모두 해결한 뒤 다시 시도하세요.".into());
    }

    rebase.commit(None, &sig, None).map_err(|e| format!("rebase commit: {e}"))?;
    while rebase.next().is_some() {
        if !collect_conflicts(&repo).is_empty() {
            return Ok(RebaseStatus {
                in_progress: true,
                current: rebase.operation_current(),
                total: rebase.len(),
                conflicted_paths: collect_conflicts(&repo),
            });
        }
        rebase.commit(None, &sig, None).map_err(|e| format!("rebase commit: {e}"))?;
    }
    rebase.finish(Some(&sig)).map_err(|e| e.to_string())?;
    Ok(RebaseStatus { in_progress: false, current: None, total: 0, conflicted_paths: vec![] })
}

#[tauri::command]
pub fn git_rebase_abort(root: String) -> Result<(), String> {
    let repo = open_repo(&root)?;
    let mut rebase = repo.open_rebase(None).map_err(|e| e.to_string())?;
    rebase.abort().map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
pub struct ConflictFile {
    pub path: String,
    pub ours: Option<String>,    // 본문 (utf-8 한정)
    pub theirs: Option<String>,
    pub ancestor: Option<String>,
}

#[tauri::command]
pub fn git_conflicts(root: String) -> Result<Vec<ConflictFile>, String> {
    let repo = open_repo(&root)?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for c in index.conflicts().into_iter().flatten().flatten() {
        let path = c
            .our
            .as_ref()
            .or(c.their.as_ref())
            .or(c.ancestor.as_ref())
            .map(|e| std::str::from_utf8(&e.path).unwrap_or("").to_string())
            .unwrap_or_default();

        let read_blob = |id: git2::Oid| -> Option<String> {
            repo.find_blob(id)
                .ok()
                .and_then(|b| std::str::from_utf8(b.content()).ok().map(String::from))
        };
        out.push(ConflictFile {
            path,
            ours: c.our.as_ref().map(|e| e.id).and_then(read_blob),
            theirs: c.their.as_ref().map(|e| e.id).and_then(read_blob),
            ancestor: c.ancestor.as_ref().map(|e| e.id).and_then(read_blob),
        });
    }
    Ok(out)
}
