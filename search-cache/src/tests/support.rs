use crate::{SearchCache, SlabIndex, SlabNodeMetadataCompact};
use fswalk::{NodeFileType, NodeMetadata};
use jiff::{civil::Date, tz::TimeZone};
use std::{
    fs, io,
    num::NonZeroU64,
    path::{Path, PathBuf},
    process,
    sync::atomic::{AtomicUsize, Ordering},
};

/// A temporary directory named `<prefix>.<pid>.<n>`, removed on drop.
// ponytail-keep: the walk indexes the ancestors of its root, so the temp dir's own name is
// searchable. `tempdir` ends it in 12 random letters and digits: one run in 62 it ended in "a",
// `a/**` also matched the temp dir and returned its child `a`; with "oo" in it, `oo` counted one
// hit too many. Digits cannot complete any word these tests search for.
pub(crate) struct TempDir(PathBuf);

impl TempDir {
    pub(crate) fn new(prefix: &str) -> io::Result<Self> {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        loop {
            let n = NEXT.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!("{prefix}.{}.{n}", process::id()));
            match fs::create_dir(&path) {
                Ok(()) => return Ok(Self(path)),
                // Left behind by a killed run that had the same pid.
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
                Err(error) => return Err(error),
            }
        }
    }

    pub(crate) fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn a_temp_dir_adds_nothing_to_its_name_that_a_search_could_match() {
    let dir = TempDir::new("named").unwrap();
    let name = dir.path().file_name().unwrap().to_str().unwrap();
    let added = name.strip_prefix("named.").unwrap();
    assert!(
        added.chars().all(|c| c.is_ascii_digit() || c == '.'),
        "{name}"
    );
}

pub(super) const SECONDS_PER_DAY: i64 = 24 * 60 * 60;

pub(super) fn set_file_times(
    cache: &mut SearchCache,
    index: SlabIndex,
    created: i64,
    modified: i64,
) {
    let metadata = NodeMetadata {
        r#type: NodeFileType::File,
        size: 0,
        ctime: NonZeroU64::new(created as u64),
        mtime: NonZeroU64::new(modified as u64),
    };
    cache.file_nodes[index].metadata = SlabNodeMetadataCompact::some(metadata);
}

pub(super) fn assert_file_hits(cache: &SearchCache, indices: &[SlabIndex], expected: &[&str]) {
    let mut names: Vec<String> = indices
        .iter()
        .filter(|idx| cache.file_nodes[**idx].file_type_hint() == NodeFileType::File)
        .filter_map(|idx| cache.node_path(*idx))
        .filter_map(|path| {
            path.file_name()
                .map(|name| name.to_string_lossy().into_owned())
        })
        .collect();
    names.sort();
    let mut expected_vec: Vec<String> = expected.iter().map(|s| s.to_string()).collect();
    expected_vec.sort();
    assert_eq!(names, expected_vec);
}

pub(super) fn ts_for_date(year: i32, month: u32, day: u32) -> i64 {
    let tz = TimeZone::system();
    let date = Date::new(
        i16::try_from(year).expect("year fits in range"),
        month as i8,
        day as i8,
    )
    .expect("valid date components");
    tz.to_zoned(date.at(12, 0, 0, 0))
        .expect("valid local date")
        .timestamp()
        .as_second()
}

pub(super) fn node_name(cache: &SearchCache, index: SlabIndex) -> String {
    cache
        .node_path(index)
        .unwrap()
        .file_name()
        .unwrap()
        .to_string_lossy()
        .into_owned()
}

pub(super) fn list_file_names(cache: &SearchCache, indices: &[SlabIndex]) -> Vec<String> {
    let mut out: Vec<String> = indices
        .iter()
        .filter(|i| cache.file_nodes[**i].file_type_hint() == NodeFileType::File)
        .map(|i| node_name(cache, *i))
        .collect();
    out.sort();
    out
}
