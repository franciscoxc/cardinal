use std::sync::atomic::{AtomicU64, Ordering};

/// How often long-running loops should check whether execution was cancelled.
pub const CANCEL_CHECK_INTERVAL: usize = 0x10000;

/// A global atomic identifies the active search version of Cardinal.
pub static ACTIVE_SEARCH_VERSION: AtomicU64 = AtomicU64::new(0);

/// A global atomic identifies the active scanning process version of Cardinal.
pub static ACTIVE_SCAN_VERSION: AtomicU64 = AtomicU64::new(0);

/// A global atomic identifies the newest request for the rows on screen.
pub static ACTIVE_VIEWPORT_VERSION: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug)]
pub struct CancellationToken {
    active_version: &'static AtomicU64,
    version: u64,
}

impl CancellationToken {
    pub fn noop() -> Self {
        static NOOP: AtomicU64 = AtomicU64::new(0);
        Self {
            version: 0,
            active_version: &NOOP,
        }
    }

    /// Creates a token for a search
    ///
    /// It increments the global search version and returns a token for
    /// that new version, so the caller does not need to specify one.
    pub fn new_search() -> Self {
        let version = self::ACTIVE_SEARCH_VERSION.fetch_add(1, Ordering::SeqCst) + 1;
        Self {
            version,
            active_version: &ACTIVE_SEARCH_VERSION,
        }
    }

    /// A token for work that belongs to the search already running, without starting a new one.
    ///
    /// Summing folders for an ordering happens on the same loop that answers searches, and is only
    /// worth anything for the result set that asked for it. Bound to the current generation, the
    /// next keystroke abandons it instead of making the user wait for an answer about results that
    /// are already gone.
    pub fn current_search() -> Self {
        Self {
            version: self::ACTIVE_SEARCH_VERSION.load(Ordering::SeqCst),
            active_version: &ACTIVE_SEARCH_VERSION,
        }
    }

    pub fn new_scan() -> Self {
        let version = self::ACTIVE_SCAN_VERSION.fetch_add(1, Ordering::SeqCst) + 1;
        Self {
            version,
            active_version: &ACTIVE_SCAN_VERSION,
        }
    }

    /// Marks a newer request for rows: whatever is still being added up for the rows asked for
    /// before gives way to it.
    ///
    /// Folder totals for the visible rows are summed on the loop that also hands out the rows, and
    /// the first sum of a large folder reads the disk for every file under it. Without a generation
    /// of its own that sum could only be interrupted by a new search, so scrolling had to wait it
    /// out. Its own generation, so a rescan does not disturb it and it does not disturb a search.
    pub fn new_viewport() -> Self {
        let version = self::ACTIVE_VIEWPORT_VERSION.fetch_add(1, Ordering::SeqCst) + 1;
        Self {
            version,
            active_version: &ACTIVE_VIEWPORT_VERSION,
        }
    }

    /// A token for work that belongs to the rows already asked for, without superseding them.
    pub fn current_viewport() -> Self {
        Self {
            version: self::ACTIVE_VIEWPORT_VERSION.load(Ordering::SeqCst),
            active_version: &ACTIVE_VIEWPORT_VERSION,
        }
    }

    pub fn is_cancelled(&self) -> Option<()> {
        if self.version != self.active_version.load(Ordering::Relaxed) {
            None
        } else {
            Some(())
        }
    }

    pub fn is_cancelled_sparse(&self, counter: usize) -> Option<()> {
        if counter.is_multiple_of(CANCEL_CHECK_INTERVAL) {
            self.is_cancelled()
        } else {
            Some(())
        }
    }

    pub fn version(&self) -> u64 {
        self.version
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, MutexGuard};

    static TEST_GUARD: Mutex<()> = Mutex::new(());

    fn lock_versions() -> MutexGuard<'static, ()> {
        TEST_GUARD
            .lock()
            .expect("version lock should not be poisoned")
    }

    fn reset_versions() {
        ACTIVE_SEARCH_VERSION.store(0, Ordering::SeqCst);
        ACTIVE_SCAN_VERSION.store(0, Ordering::SeqCst);
        ACTIVE_VIEWPORT_VERSION.store(0, Ordering::SeqCst);
    }

    #[test]
    fn noop_token_is_never_cancelled() {
        let _guard = lock_versions();
        reset_versions();
        let token = CancellationToken::noop();
        assert!(
            token.is_cancelled().is_some(),
            "noop token should never be cancelled"
        );
    }

    #[test]
    fn search_token_cancelled_after_new_search_version() {
        let _guard = lock_versions();
        reset_versions();

        let search_v1 = CancellationToken::new_search();
        assert!(
            search_v1.is_cancelled().is_some(),
            "latest search token should start active"
        );

        let search_v2 = CancellationToken::new_search();
        assert!(
            search_v2.is_cancelled().is_some(),
            "new search token should be active"
        );
        assert!(
            search_v1.is_cancelled().is_none(),
            "older search token should be cancelled by newer search"
        );
    }

    #[test]
    fn cancelled_after_version_change() {
        let _guard = lock_versions();
        reset_versions();
        let token_v1 = CancellationToken::new_search();
        assert!(
            token_v1.is_cancelled().is_some(),
            "initial version should be active"
        );

        // Bump the active version, cancelling the older token.
        let _token_v2 = CancellationToken::new_search();
        assert!(token_v1.is_cancelled().is_none());
    }

    #[test]
    fn scan_token_cancelled_after_new_scan_version() {
        let _guard = lock_versions();
        reset_versions();

        let scan_v1 = CancellationToken::new_scan();
        assert!(
            scan_v1.is_cancelled().is_some(),
            "latest scan token should start active"
        );

        let scan_v2 = CancellationToken::new_scan();
        assert!(
            scan_v2.is_cancelled().is_some(),
            "new scan token should be active"
        );
        assert!(
            scan_v1.is_cancelled().is_none(),
            "older scan token should be cancelled by newer scan"
        );
    }

    #[test]
    fn scan_versions_do_not_cancel_search_tokens() {
        let _guard = lock_versions();
        reset_versions();

        let search_v1 = CancellationToken::new_search();
        let _scan_v1 = CancellationToken::new_scan();
        assert!(
            search_v1.is_cancelled().is_some(),
            "scan token updates should not affect search version"
        );

        let _search_v2 = CancellationToken::new_search();
        assert!(
            search_v1.is_cancelled().is_none(),
            "search token should still be governed by search version updates"
        );
    }

    #[test]
    fn work_for_the_rows_on_screen_gives_way_to_a_newer_request_for_rows() {
        let _guard = lock_versions();
        reset_versions();

        let _first_rows = CancellationToken::new_viewport();
        let sums = CancellationToken::current_viewport();
        assert!(
            sums.is_cancelled().is_some(),
            "joining the rows already asked for supersedes nothing"
        );

        // Neither of these asked for rows; who else has to end a sum is the caller's decision.
        let _search = CancellationToken::new_search();
        let _scan = CancellationToken::new_scan();
        assert!(
            sums.is_cancelled().is_some(),
            "only a newer request for rows moves this generation"
        );

        let _next_rows = CancellationToken::new_viewport();
        assert!(
            sums.is_cancelled().is_none(),
            "scrolling on has to be able to interrupt the sums of the rows left behind"
        );
        assert!(
            CancellationToken::current_viewport()
                .is_cancelled()
                .is_some(),
            "and the sums asked for after it belong to the new rows"
        );
    }
}
