use fswalk::NodeFileType;
use search_cache::{SearchResultNode, SlabIndex};
use serde::Deserialize;
use std::{cmp::Ordering as StdOrdering, path::Path};

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SortStatePayload {
    pub key: SortKeyPayload,
    pub direction: SortDirectionPayload,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SortKeyPayload {
    Filename,
    FullPath,
    Size,
    Mtime,
    Ctime,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SortDirectionPayload {
    Asc,
    Desc,
}

#[derive(Debug)]
pub(crate) struct SortEntry {
    pub(crate) slab_index: SlabIndex,
    node: SearchResultNode,
    path_key: String,
    name_key: String,
    /// What the Size column is showing for a folder, when folder totals are turned on.
    folder_size: Option<i64>,
}

impl SortEntry {
    pub(crate) fn new(
        slab_index: SlabIndex,
        node: SearchResultNode,
        folder_size: Option<i64>,
    ) -> Self {
        let path_key = normalize_path(&node.path);
        let name_key = extract_filename(&node);
        Self {
            slab_index,
            node,
            path_key,
            name_key,
            folder_size,
        }
    }
}

pub(crate) fn sort_entries(
    entries: &mut [SortEntry],
    sort: &SortStatePayload,
    folders_first: bool,
) {
    entries.sort_by(|a, b| {
        // ponytail-keep: ahead of the chosen key and outside the direction flip. Grouping is not a
        // tie-break — `type_order` was already one of those, and it never fired because names
        // differ — and it must not invert with the arrow: folders belong on top whether the column
        // is ascending or descending, the way Finder does it.
        if folders_first {
            let grouping = type_order(&a.node).cmp(&type_order(&b.node));
            if grouping != StdOrdering::Equal {
                return grouping;
            }
        }
        compare_entries(a, b, sort)
    });
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn extract_filename(node: &SearchResultNode) -> String {
    node.path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|x| x.to_string())
        .unwrap_or_else(|| node.path.to_string_lossy().into_owned())
}

fn sort_numeric(entry: &SortEntry, key: SortKeyPayload) -> i64 {
    // ponytail-keep: a folder's total wins over its metadata size. `meta_ref.size()` is the size of
    // the directory inode — a few hundred bytes, near enough the same for every folder — so sorting
    // on it made every folder tie and fall back to name order while the column showed the real
    // total. Anything the user can see has to be what the ordering uses.
    if let (SortKeyPayload::Size, Some(bytes)) = (key, entry.folder_size) {
        return bytes;
    }

    let Some(meta_ref) = entry.node.metadata.as_ref() else {
        return i64::MIN;
    };
    match key {
        SortKeyPayload::Size => meta_ref.size(),
        SortKeyPayload::Mtime => meta_ref
            .mtime()
            .map(|value| value.get() as i64)
            .unwrap_or(i64::MIN),
        SortKeyPayload::Ctime => meta_ref
            .ctime()
            .map(|value| value.get() as i64)
            .unwrap_or(i64::MIN),
        SortKeyPayload::FullPath | SortKeyPayload::Filename => 0,
    }
}

fn type_order(node: &SearchResultNode) -> u8 {
    match node.metadata.as_ref().map(|m| m.r#type()) {
        Some(NodeFileType::Dir) => 0,
        None => 2,
        _ => 1,
    }
}

fn compare_entries(a: &SortEntry, b: &SortEntry, sort: &SortStatePayload) -> StdOrdering {
    let ordering = match sort.key {
        SortKeyPayload::FullPath => a
            .path_key
            .cmp(&b.path_key)
            .then_with(|| a.name_key.cmp(&b.name_key))
            .then_with(|| type_order(&a.node).cmp(&type_order(&b.node))),
        SortKeyPayload::Filename => a
            .name_key
            .cmp(&b.name_key)
            .then_with(|| type_order(&a.node).cmp(&type_order(&b.node)))
            .then_with(|| a.path_key.cmp(&b.path_key)),
        SortKeyPayload::Size | SortKeyPayload::Mtime | SortKeyPayload::Ctime => {
            sort_numeric(a, sort.key)
                .cmp(&sort_numeric(b, sort.key))
                .then_with(|| a.name_key.cmp(&b.name_key))
                .then_with(|| type_order(&a.node).cmp(&type_order(&b.node)))
                .then_with(|| a.path_key.cmp(&b.path_key))
        }
    };

    match sort.direction {
        SortDirectionPayload::Asc => ordering,
        SortDirectionPayload::Desc => ordering.reverse(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fswalk::NodeMetadata;
    use search_cache::SlabNodeMetadataCompact;
    use std::path::PathBuf;

    fn entry_with_metadata(
        slab_index: usize,
        path: &str,
        metadata: SlabNodeMetadataCompact,
    ) -> SortEntry {
        entry_with_folder_size(slab_index, path, metadata, None)
    }

    fn entry_with_folder_size(
        slab_index: usize,
        path: &str,
        metadata: SlabNodeMetadataCompact,
        folder_size: Option<i64>,
    ) -> SortEntry {
        let node = SearchResultNode {
            path: PathBuf::from(path),
            metadata,
        };

        SortEntry::new(SlabIndex::new(slab_index), node, folder_size)
    }

    fn metadata_with_type(r#type: NodeFileType, size: u64) -> SlabNodeMetadataCompact {
        SlabNodeMetadataCompact::some(NodeMetadata {
            r#type,
            size,
            ctime: None,
            mtime: None,
        })
    }

    #[test]
    fn filename_sort_keeps_directories_before_files() {
        let sort_state = SortStatePayload {
            key: SortKeyPayload::Filename,
            direction: SortDirectionPayload::Asc,
        };
        let mut entries = vec![
            entry_with_metadata(
                1,
                "/tmp/b/foo.txt",
                metadata_with_type(NodeFileType::File, 0),
            ),
            entry_with_metadata(2, "/tmp/c/foo.txt", SlabNodeMetadataCompact::none()),
            entry_with_metadata(
                0,
                "/tmp/a/foo.txt",
                metadata_with_type(NodeFileType::Dir, 0),
            ),
        ];

        sort_entries(&mut entries, &sort_state, false);
        let order: Vec<usize> = entries.iter().map(|entry| entry.slab_index.get()).collect();

        assert_eq!(
            order,
            vec![0, 1, 2],
            "directories should be listed before files, and files before nodes without metadata"
        );
    }

    #[test]
    fn size_sort_prioritizes_directories_and_paths_for_ties() {
        let sort_state = SortStatePayload {
            key: SortKeyPayload::Size,
            direction: SortDirectionPayload::Asc,
        };
        let mut entries = vec![
            entry_with_metadata(1, "/tmp/z/foo", metadata_with_type(NodeFileType::File, 5)),
            entry_with_metadata(0, "/tmp/m/foo", metadata_with_type(NodeFileType::Dir, 5)),
            entry_with_metadata(2, "/tmp/a/foo", metadata_with_type(NodeFileType::File, 5)),
        ];

        sort_entries(&mut entries, &sort_state, false);
        let order: Vec<usize> = entries.iter().map(|entry| entry.slab_index.get()).collect();

        assert_eq!(
            order,
            vec![0, 2, 1],
            "directories stay ahead when size and names match, while files fall back to path order"
        );
    }

    #[test]
    fn folders_first_groups_ahead_of_the_key_and_survives_the_arrow() {
        let entries = || {
            vec![
                entry_with_metadata(0, "/tmp/aaa.txt", metadata_with_type(NodeFileType::File, 9)),
                entry_with_metadata(1, "/tmp/zzz", metadata_with_type(NodeFileType::Dir, 1)),
                entry_with_metadata(2, "/tmp/bbb.txt", metadata_with_type(NodeFileType::File, 5)),
                entry_with_metadata(3, "/tmp/mmm", metadata_with_type(NodeFileType::Dir, 1)),
            ]
        };

        for direction in [SortDirectionPayload::Asc, SortDirectionPayload::Desc] {
            let sort_state = SortStatePayload {
                key: SortKeyPayload::Filename,
                direction,
            };
            let mut list = entries();
            sort_entries(&mut list, &sort_state, true);
            let kinds: Vec<u8> = list.iter().map(|entry| type_order(&entry.node)).collect();
            // Folders on top in both directions: grouping is not part of what the arrow flips, or
            // sorting descending would bury them under the files.
            assert_eq!(kinds, vec![0, 0, 1, 1], "direction {direction:?}");
        }

        // Ascending by name inside each group, which is the point of grouping rather than sorting
        // by type: the chosen order still decides everything within the folders and the files.
        let mut list = entries();
        sort_entries(
            &mut list,
            &SortStatePayload {
                key: SortKeyPayload::Filename,
                direction: SortDirectionPayload::Asc,
            },
            true,
        );
        let order: Vec<usize> = list.iter().map(|entry| entry.slab_index.get()).collect();
        assert_eq!(order, vec![3, 1, 0, 2], "mmm, zzz, then aaa.txt, bbb.txt");

        // Off, the same list falls back to plain name order and the folders scatter.
        let mut list = entries();
        sort_entries(
            &mut list,
            &SortStatePayload {
                key: SortKeyPayload::Filename,
                direction: SortDirectionPayload::Asc,
            },
            false,
        );
        let order: Vec<usize> = list.iter().map(|entry| entry.slab_index.get()).collect();
        assert_eq!(order, vec![0, 2, 3, 1]);
    }

    #[test]
    fn size_sort_ranks_folders_by_what_they_hold() {
        let sort_state = SortStatePayload {
            key: SortKeyPayload::Size,
            direction: SortDirectionPayload::Desc,
        };
        // Every directory inode reports the same handful of bytes, which is why the totals have to
        // reach the comparison: without them these three tie and come out in name order.
        let mut entries = vec![
            entry_with_folder_size(
                0,
                "/tmp/a",
                metadata_with_type(NodeFileType::Dir, 96),
                Some(5),
            ),
            entry_with_folder_size(
                1,
                "/tmp/b",
                metadata_with_type(NodeFileType::Dir, 96),
                Some(9_000),
            ),
            entry_with_folder_size(
                2,
                "/tmp/c",
                metadata_with_type(NodeFileType::Dir, 96),
                Some(700),
            ),
        ];

        sort_entries(&mut entries, &sort_state, false);
        let order: Vec<usize> = entries.iter().map(|entry| entry.slab_index.get()).collect();

        assert_eq!(order, vec![1, 2, 0], "biggest folder first");
    }
}
