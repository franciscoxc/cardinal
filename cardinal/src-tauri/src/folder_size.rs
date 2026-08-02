//! Completing a folder total by walking the parts the index deliberately skipped.
//!
//! The excluded directories are the caches and cloud mirrors that were left out to save battery,
//! so this is the expensive half of the feature and stays behind a preference. It runs on its own
//! thread, throttled, and reports as it goes: a partial total is still a true lower bound, so the
//! number can grow on screen instead of appearing at the end.

use crossbeam_channel::{Receiver, Sender, bounded};
use search_cancel::CancellationToken;
use std::{
    fs,
    path::PathBuf,
    thread,
    time::{Duration, Instant},
};
use tracing::warn;

/// How often a walk in progress reports what it has added up so far.
const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);

pub struct WalkRequest {
    /// Identifies the row this belongs to; echoed back untouched.
    pub slab_index: u64,
    pub roots: Vec<PathBuf>,
    /// What the index already accounted for. Progress is reported as a running total.
    pub indexed_bytes: i64,
    pub cancellation_token: CancellationToken,
}

/// What reaches the UI. Mirrors `WalkProgress` because the wire shape is camelCase and the worker
/// should not have to care.
#[derive(Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSizeUpdate {
    pub slab_index: u64,
    pub bytes: i64,
    pub done: bool,
}

#[derive(Clone, Copy)]
pub struct WalkProgress {
    pub slab_index: u64,
    pub bytes: i64,
    /// Nothing is left to add: the number is a total rather than a lower bound.
    pub done: bool,
}

// Not in the libc crate for macOS, so declared here from <sys/resource.h>. The values are part of
// the stable syscall interface; the header is where they are documented.
const IOPOL_TYPE_DISK: libc::c_int = 0;
const IOPOL_SCOPE_THREAD: libc::c_int = 1;
const IOPOL_THROTTLE: libc::c_int = 3;

unsafe extern "C" {
    fn setiopolicy_np(iotype: libc::c_int, scope: libc::c_int, policy: libc::c_int) -> libc::c_int;
}

/// Drops this thread to background priority for both CPU and disk.
///
/// Two knobs, not one. QoS alone still lets the walk compete for the disk, and the excluded
/// directories are precisely the ones with hundreds of thousands of small files — the throttle is
/// what keeps a size calculation from making the rest of the machine feel slow. It is the same
/// policy Spotlight and Time Machine use for their own indexing.
fn lower_this_thread_priority() {
    // SAFETY: both take only the constants below and act on the calling thread.
    unsafe {
        // QOS_CLASS_BACKGROUND
        libc::pthread_set_qos_class_self_np(libc::qos_class_t::QOS_CLASS_BACKGROUND, 0);
        setiopolicy_np(IOPOL_TYPE_DISK, IOPOL_SCOPE_THREAD, IOPOL_THROTTLE);
    }
}

/// Adds up `roots` on disk, reporting the running total as it goes.
fn walk_roots(request: &WalkRequest, progress_tx: &Sender<WalkProgress>) {
    let WalkRequest {
        slab_index,
        roots,
        indexed_bytes,
        cancellation_token,
    } = request;

    let mut total = *indexed_bytes;
    let mut last_report = Instant::now();
    let mut pending: Vec<PathBuf> = roots.clone();

    while let Some(dir) = pending.pop() {
        if cancellation_token.is_cancelled().is_none() {
            return;
        }

        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            // Unreadable is expected here: these paths were excluded partly because the app has no
            // business in them. Skipping keeps the total a lower bound, which it already was.
            Err(error) => {
                warn!("Skipping {dir:?} while sizing a folder: {error}");
                continue;
            }
        };

        for entry in entries.flatten() {
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if metadata.is_dir() {
                pending.push(entry.path());
            } else if metadata.is_file() {
                total = total.saturating_add(metadata.len() as i64);
            }
        }

        if last_report.elapsed() >= PROGRESS_INTERVAL {
            last_report = Instant::now();
            let _ = progress_tx.send(WalkProgress {
                slab_index: *slab_index,
                bytes: total,
                done: false,
            });
        }
    }

    let _ = progress_tx.send(WalkProgress {
        slab_index: *slab_index,
        bytes: total,
        done: true,
    });
}

/// Starts the worker and returns the channel to queue walks on.
pub fn spawn_worker(progress_tx: Sender<WalkProgress>) -> Sender<WalkRequest> {
    let (request_tx, request_rx): (Sender<WalkRequest>, Receiver<WalkRequest>) = bounded(64);

    thread::Builder::new()
        .name("folder-size".into())
        .spawn(move || {
            lower_this_thread_priority();
            // One thread on purpose. Parallel walks would multiply the disk pressure this is
            // trying to avoid, and the rows are answered one viewport at a time anyway.
            while let Ok(request) = request_rx.recv() {
                if request.cancellation_token.is_cancelled().is_none() {
                    continue;
                }
                walk_roots(&request, &progress_tx);
            }
        })
        .expect("failed to spawn the folder-size worker");

    request_tx
}

/// Bytes held under `roots`, walked to completion. Used by the tests; the app streams instead.
#[cfg(test)]
pub fn walk_roots_blocking(roots: Vec<PathBuf>) -> i64 {
    let (tx, rx) = bounded(64);
    walk_roots(
        &WalkRequest {
            slab_index: 0,
            roots,
            indexed_bytes: 0,
            cancellation_token: CancellationToken::noop(),
        },
        &tx,
    );
    drop(tx);
    rx.iter().last().map(|progress| progress.bytes).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempdir::TempDir;

    #[test]
    fn adds_up_everything_under_the_roots() {
        let temp = TempDir::new("folder_size_walk").unwrap();
        let dir = temp.path();
        fs::create_dir_all(dir.join("caches/deep")).unwrap();
        fs::write(dir.join("caches/a.bin"), vec![0u8; 400]).unwrap();
        fs::write(dir.join("caches/deep/b.bin"), vec![0u8; 600]).unwrap();
        fs::write(dir.join("outside.bin"), vec![0u8; 999]).unwrap();

        // Only what hangs off the given root counts; the sibling outside it does not.
        assert_eq!(walk_roots_blocking(vec![dir.join("caches")]), 1000);
    }

    #[test]
    fn a_missing_root_is_skipped_rather_than_failing() {
        let temp = TempDir::new("folder_size_missing").unwrap();
        let dir = temp.path();
        fs::create_dir_all(dir.join("real")).unwrap();
        fs::write(dir.join("real/a.bin"), vec![0u8; 120]).unwrap();

        // These paths were excluded partly because the app may not be allowed in them, so an
        // unreadable one has to leave the rest of the total intact.
        let total = walk_roots_blocking(vec![dir.join("real"), dir.join("gone")]);
        assert_eq!(total, 120);
    }
}
