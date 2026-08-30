use crate::{
    DEFAULT_SYSTEM_IGNORE_PATH, LOGIC_START, LogicStartConfig,
    lifecycle::load_app_state,
    quicklook::{
        QuickLookItemInput, close_preview_panel, toggle_preview_panel, update_preview_panel,
    },
    search_activity,
    sort::{SortEntry, SortStatePayload, sort_entries},
    window_controls::{activate_main_window_impl, hide_main_window_impl, toggle_main_window_impl},
};
use anyhow::{Result, anyhow};
use base64::{Engine as _, engine::general_purpose};
use camino::{Utf8Path as Path, Utf8PathBuf as PathBuf};
use crossbeam_channel::{Sender, bounded};
use objc2::{
    rc::{Retained, autoreleasepool},
    runtime::ProtocolObject,
};
use objc2_app_kit::{NSPasteboard, NSPasteboardItem, NSPasteboardTypeString, NSPasteboardWriting};
use objc2_foundation::{NSArray, NSString, NSURL};
use parking_lot::Mutex;
use rayon::prelude::*;
use search_cache::{
    SearchOptions, SearchOutcome, SearchQuery, SearchResultNode, SlabIndex, SlabNodeMetadata,
    content_snippet, content_terms_of_query,
};
use search_cancel::CancellationToken;
use serde::{Deserialize, Serialize};
use std::{cell::LazyCell, process::Command};
use tauri::{ActivationPolicy, AppHandle, Manager, State};
use tracing::{error, info, warn};

#[derive(Debug, Clone)]
pub struct WatchConfigUpdate {
    pub watch_root: String,
    pub ignore_paths: Vec<String>,
    pub include_paths: Vec<String>,
    pub scan_cancellation_token: CancellationToken,
}

#[derive(Debug, Clone, Copy, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptionsPayload {
    #[serde(default)]
    pub case_insensitive: bool,
}

impl From<SearchOptionsPayload> for SearchOptions {
    fn from(SearchOptionsPayload { case_insensitive }: SearchOptionsPayload) -> Self {
        SearchOptions { case_insensitive }
    }
}

#[derive(Debug, Clone)]
pub struct SearchJob {
    pub query: SearchQuery,
    pub options: SearchOptionsPayload,
    pub cancellation_token: CancellationToken,
    pub result_tx: Sender<Result<SearchOutcome>>,
}

#[derive(Debug, Clone)]
pub struct NodeInfoRequest {
    pub slab_indices: Vec<SlabIndex>,
    /// Only the rows on screen ask for folder sizes: the sum walks the subtree, so asking for
    /// every result would traverse the whole index on each keystroke.
    pub folder_sizes: bool,
    /// Also walk the excluded directories on disk to complete those totals. Expensive by
    /// definition — these are the paths left out to save battery — so it is opt-in twice over.
    pub deep_folder_sizes: bool,
    pub response_tx: Sender<NodeInfoResponse>,
}

/// Folder sizes travel beside the nodes rather than inside `SearchResultNode`, which belongs to
/// search-cache and knows nothing about what a viewport is asking for.
pub struct NodeInfoResponse {
    pub nodes: Vec<SearchResultNode>,
    /// One entry per node, `None` for anything that is not a directory.
    pub folder_sizes: Vec<Option<FolderSize>>,
}

#[derive(Clone, Copy)]
pub struct FolderSize {
    pub bytes: i64,
    /// Something under the folder is missing from the total: unreadable, or kept out by the watch
    /// configuration. The UI shows the number as a lower bound when this is set.
    pub incomplete: bool,
}

#[derive(Default)]
struct SortedViewCache {
    slab_indices: Vec<SlabIndex>,
    nodes: Vec<SearchResultNode>,
    /// Empty when the cached request did not ask for folder totals, which is not the same as
    /// "asked and got none": a sort by size must not reuse an entry filled in without them.
    folder_sizes: Vec<Option<FolderSize>>,
}

/// Totals the background walk has finished, kept so an ordering can use them.
///
/// The walk streams its running total to the UI and nothing else remembered it, so re-sorting
/// would have had to walk the disk again — several times a second, since the progress events are
/// what triggers the re-sort. Keyed by slab index and dropped when a new search starts, which is
/// also when the walks for the previous result set are abandoned.
pub type DeepFolderSizes = std::sync::Arc<Mutex<std::collections::HashMap<u64, i64>>>;

pub struct SearchState {
    search_tx: Sender<SearchJob>,
    node_info_tx: Sender<NodeInfoRequest>,
    icon_viewport_tx: Sender<(u64, Vec<SlabIndex>)>,
    rescan_tx: Sender<CancellationToken>,
    watch_config_tx: Sender<WatchConfigUpdate>,
    sorted_view_cache: Mutex<Option<SortedViewCache>>,
    deep_folder_sizes: DeepFolderSizes,
    pub(crate) update_window_state_tx: Sender<()>,
}

impl SearchState {
    pub fn new(
        search_tx: Sender<SearchJob>,
        node_info_tx: Sender<NodeInfoRequest>,
        icon_viewport_tx: Sender<(u64, Vec<SlabIndex>)>,
        rescan_tx: Sender<CancellationToken>,
        watch_config_tx: Sender<WatchConfigUpdate>,
        deep_folder_sizes: DeepFolderSizes,
        update_window_state_tx: Sender<()>,
    ) -> Self {
        Self {
            search_tx,
            node_info_tx,
            icon_viewport_tx,
            rescan_tx,
            watch_config_tx,
            sorted_view_cache: Mutex::new(None),
            deep_folder_sizes,
            update_window_state_tx,
        }
    }

    fn request_node_info(
        &self,
        slab_indices: Vec<SlabIndex>,
        folder_sizes: bool,
        deep_folder_sizes: bool,
    ) -> NodeInfoResponse {
        let empty = || NodeInfoResponse {
            nodes: Vec::new(),
            folder_sizes: Vec::new(),
        };
        if slab_indices.is_empty() {
            return empty();
        }

        let (response_tx, response_rx) = bounded::<NodeInfoResponse>(1);
        if let Err(e) = self.node_info_tx.send(NodeInfoRequest {
            slab_indices,
            folder_sizes,
            deep_folder_sizes,
            response_tx,
        }) {
            error!("Failed to send node info request: {e:?}");
            return empty();
        }

        response_rx.recv().unwrap_or_else(|e| {
            error!("Failed to receive node info results: {e:?}");
            empty()
        })
    }

    fn fetch_sorted_nodes(
        &self,
        slab_indices: &[SlabIndex],
        folder_sizes: bool,
        deep_folder_sizes: bool,
    ) -> (Vec<SearchResultNode>, Vec<Option<FolderSize>>) {
        if slab_indices.is_empty() {
            return (Vec::new(), Vec::new());
        }

        // ponytail-keep: the lock is taken twice on purpose, and never held across the request
        // below. That request blocks until the background loop answers, and summing folders for an
        // ordering can keep that loop busy — so holding the lock across it made every other caller
        // queue behind a mutex as well as behind the loop, for work that was already redundant.
        if let Some(cached) = self
            .sorted_view_cache
            .lock()
            .as_ref()
            .filter(|cache| cache.slab_indices == slab_indices)
            // Totals are what re-sorting during a walk reuses; without this an entry cached by an
            // earlier sort on another column would answer a sort by size with no sizes at all.
            .filter(|cache| !folder_sizes || !cache.folder_sizes.is_empty())
            .map(|cache| (cache.nodes.clone(), cache.folder_sizes.clone()))
        {
            return cached;
        }

        let response =
            self.request_node_info(slab_indices.to_vec(), folder_sizes, deep_folder_sizes);
        *self.sorted_view_cache.lock() = Some(SortedViewCache {
            slab_indices: slab_indices.to_vec(),
            nodes: response.nodes.clone(),
            folder_sizes: response.folder_sizes.clone(),
        });
        (response.nodes, response.folder_sizes)
    }

    /// Forgets the totals the background walk reported: they belong to the previous result set.
    fn clear_deep_folder_sizes(&self) {
        self.deep_folder_sizes.lock().clear();
    }
}

/// Normalizes user-provided path input into an absolute path string.
///
/// Expands a leading `~` component using the current `HOME` directory and rejects
/// non-absolute paths (including relative paths and unsupported `~user` forms).
/// Returns `Some` absolute path string when valid, otherwise `None`.
fn normalize_path_input(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let path = Path::new(trimmed);
    let mut expanded = PathBuf::new();
    let home = LazyCell::new(|| {
        std::env::var_os("HOME").and_then(|h| h.to_string_lossy().into_owned().into())
    });

    for (index, component) in path.into_iter().enumerate() {
        if index == 0 && component == "~" {
            expanded.push(home.as_deref()?);
        } else {
            expanded.push(component);
        }
    }

    let resolved = expanded.into_string();
    if resolved.starts_with('/') {
        Some(resolved)
    } else {
        None
    }
}

pub(crate) fn normalize_watch_config(
    watch_root: &str,
    ignore_paths: Vec<String>,
    include_paths: Vec<String>,
    fallback_watch_root: Option<&str>,
) -> Option<(String, Vec<String>, Vec<String>)> {
    let watch_root = normalize_path_input(watch_root)
        .or_else(|| fallback_watch_root.and_then(normalize_path_input))?;
    let mut ignore_paths = ignore_paths
        .into_iter()
        .filter_map(|path| {
            let normalized = normalize_path_input(&path);
            if normalized.is_none() {
                warn!("Ignoring invalid ignore path: {path:?}");
            }
            normalized
        })
        .collect::<Vec<_>>();
    if !ignore_paths
        .iter()
        .any(|path| path == DEFAULT_SYSTEM_IGNORE_PATH)
    {
        ignore_paths.push(DEFAULT_SYSTEM_IGNORE_PATH.to_string());
    }
    let include_paths = include_paths
        .into_iter()
        .filter_map(|path| {
            let normalized = normalize_path_input(&path);
            if normalized.is_none() {
                warn!("Ignoring invalid include path: {path:?}");
            }
            normalized
        })
        .collect::<Vec<_>>();
    Some((watch_root, ignore_paths, include_paths))
}

#[derive(Serialize)]
pub struct NodeInfo {
    pub path: String,
    pub metadata: Option<NodeInfoMetadata>,
    pub icon: Option<String>,
    #[serde(rename = "contentContext")]
    pub content_context: Option<String>,
    /// Bytes held by a directory, absent for files and when the caller did not ask.
    #[serde(rename = "folderSize")]
    pub folder_size: Option<i64>,
    /// The folder's total is a lower bound: something under it is unreadable or excluded.
    #[serde(rename = "folderSizeIncomplete")]
    pub folder_size_incomplete: Option<bool>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub results: Vec<SlabIndex>,
    pub highlights: Vec<String>,
    /// `content:` terms of this query, so the UI highlights in a snippet exactly what the search
    /// looked for inside files.
    pub content_terms: Vec<String>,
    pub status_code: u8,
}

impl SearchResponse {
    pub const OK: u8 = 0;
    pub const CANCELLED: u8 = 1;
}

#[derive(Serialize)]
pub struct NodeInfoMetadata {
    pub r#type: u8,
    pub size: i64,
    pub ctime: u32,
    pub mtime: u32,
}

impl NodeInfoMetadata {
    pub fn from_metadata(metadata: SlabNodeMetadata<'_>) -> Self {
        Self {
            r#type: metadata.r#type() as u8,
            size: metadata.size(),
            ctime: metadata.ctime().map(|x| x.get()).unwrap_or_default(),
            mtime: metadata.mtime().map(|x| x.get()).unwrap_or_default(),
        }
    }
}

#[tauri::command]
pub async fn close_quicklook(app_handle: AppHandle) {
    let app_handle_cloned = app_handle.clone();
    if let Err(e) = app_handle.run_on_main_thread(move || {
        close_preview_panel(app_handle_cloned);
    }) {
        error!("Failed to dispatch quicklook action: {e:?}");
    }
}

#[tauri::command]
pub async fn update_quicklook(app_handle: AppHandle, items: Vec<QuickLookItemInput>) {
    let app_handle_cloned = app_handle.clone();
    if let Err(e) = app_handle.run_on_main_thread(move || {
        update_preview_panel(app_handle_cloned, items);
    }) {
        error!("Failed to dispatch quicklook action: {e:?}");
    }
}

#[tauri::command]
pub async fn toggle_quicklook(app_handle: AppHandle, items: Vec<QuickLookItemInput>) {
    let app_handle_cloned = app_handle.clone();
    if let Err(e) = app_handle.run_on_main_thread(move || {
        toggle_preview_panel(app_handle_cloned, items);
    }) {
        error!("Failed to dispatch quicklook action: {e:?}");
    }
}

#[tauri::command]
pub async fn search(
    directory_query: Option<String>,
    query: Option<String>,
    options: Option<SearchOptionsPayload>,
    state: State<'_, SearchState>,
) -> Result<SearchResponse, String> {
    search_activity::note_search_activity();

    let options = options.unwrap_or_default();
    let content_terms = query
        .as_deref()
        .map(content_terms_of_query)
        .unwrap_or_default();
    // Totals walked for the previous result set say nothing about this one, and the walks behind
    // them are about to be abandoned anyway.
    state.clear_deep_folder_sizes();
    let cancellation_token = CancellationToken::new_search();
    let (result_tx, result_rx) = bounded(1);
    if let Err(e) = state.search_tx.send(SearchJob {
        query: SearchQuery {
            directory_query,
            query,
        },
        options,
        cancellation_token,
        result_tx,
    }) {
        error!("Failed to send search request: {e:?}");
        return Err(format!("Failed to send search request: {e:?}"));
    }

    match result_rx.recv() {
        Ok(res) => res,
        Err(e) => {
            error!("Failed to receive search result: {e:?}");
            return Err(format!("Failed to receive search result: {e:?}"));
        }
    }
    .map(|SearchOutcome { nodes, highlights }| {
        let (status_code, results) = match nodes {
            Some(list) => (SearchResponse::OK, list),
            None => {
                let version = cancellation_token.version();
                info!("Search {version} was cancelled");
                (SearchResponse::CANCELLED, vec![])
            }
        };
        SearchResponse {
            results,
            highlights,
            content_terms,
            status_code,
        }
    })
    .map_err(|e| format!("Failed to process search result: {e:?}"))
}

#[tauri::command(async)]
pub fn get_nodes_info(
    results: Vec<SlabIndex>,
    include_icons: Option<bool>,
    content_terms: Option<Vec<String>>,
    case_insensitive: Option<bool>,
    folder_sizes: Option<bool>,
    deep_folder_sizes: Option<bool>,
    state: State<'_, SearchState>,
) -> Vec<NodeInfo> {
    if results.is_empty() {
        return Vec::new();
    }

    let include_icons = include_icons.unwrap_or(true);
    let content_terms = content_terms.unwrap_or_default();
    let case_insensitive = case_insensitive.unwrap_or_default();
    let NodeInfoResponse {
        nodes,
        folder_sizes,
    } = state.request_node_info(
        results,
        folder_sizes.unwrap_or_default(),
        deep_folder_sizes.unwrap_or_default(),
    );

    // Rows are independent, and each one may read a file for its icon and its content snippet.
    nodes
        .into_par_iter()
        .enumerate()
        .map(|(row, SearchResultNode { path, metadata })| {
            let content_context = content_terms
                .iter()
                .find_map(|term| content_snippet(&path, term, case_insensitive));
            let path = path.to_string_lossy().into_owned();
            let icon = if include_icons {
                fs_icon::icon_of_path_ns(&path).map(|data| {
                    format!(
                        "data:image/png;base64,{}",
                        general_purpose::STANDARD.encode(data)
                    )
                })
            } else {
                None
            };
            let folder_size = folder_sizes.get(row).copied().flatten();
            NodeInfo {
                path,
                icon,
                metadata: metadata.as_ref().map(NodeInfoMetadata::from_metadata),
                content_context,
                folder_size: folder_size.map(|size| size.bytes),
                folder_size_incomplete: folder_size.map(|size| size.incomplete),
            }
        })
        .collect()
}

#[tauri::command(async)]
pub fn get_sorted_view(
    results: Vec<SlabIndex>,
    sort: Option<SortStatePayload>,
    folder_sizes: Option<bool>,
    deep_folder_sizes: Option<bool>,
    state: State<'_, SearchState>,
) -> Vec<SlabIndex> {
    if results.is_empty() || sort.is_none() {
        return results;
    }

    let sort_state = sort.expect("checked above");
    let want_folder_sizes = folder_sizes.unwrap_or(false);
    let (nodes, sizes) = state.fetch_sorted_nodes(
        &results,
        want_folder_sizes,
        deep_folder_sizes.unwrap_or(false),
    );
    // What the walk has finished beats what the index alone could add up, and it is only ever
    // larger: the walk starts from the indexed sum and grows it.
    let walked = want_folder_sizes.then(|| state.deep_folder_sizes.lock().clone());

    let mut entries: Vec<SortEntry> = results
        .into_iter()
        .zip(nodes)
        .enumerate()
        .map(|(position, (slab_index, node))| {
            let folder_size = sizes
                .get(position)
                .copied()
                .flatten()
                .map(|size| size.bytes)
                .map(|indexed| {
                    walked
                        .as_ref()
                        .and_then(|walked| walked.get(&(slab_index.get() as u64)).copied())
                        .unwrap_or(indexed)
                });
            SortEntry::new(slab_index, node, folder_size)
        })
        .collect();

    sort_entries(&mut entries, &sort_state);

    entries.into_iter().map(|entry| entry.slab_index).collect()
}

#[tauri::command(async)]
pub fn update_icon_viewport(id: u64, viewport: Vec<SlabIndex>, state: State<'_, SearchState>) {
    if let Err(e) = state.icon_viewport_tx.send((id, viewport)) {
        error!("Failed to send icon viewport update: {e:?}");
    }
}

#[tauri::command]
pub async fn get_app_status() -> String {
    load_app_state().as_str().to_string()
}

#[tauri::command(async)]
pub fn trigger_rescan(state: State<'_, SearchState>) {
    if let Err(e) = state.rescan_tx.send(CancellationToken::new_scan()) {
        error!("Failed to request rescan: {e:?}");
    }
}

#[tauri::command(async)]
pub fn set_watch_config(
    watch_root: String,
    ignore_paths: Vec<String>,
    include_paths: Option<Vec<String>>,
    state: State<'_, SearchState>,
) {
    let Some((watch_root, ignore_paths, include_paths)) = normalize_watch_config(
        &watch_root,
        ignore_paths,
        include_paths.unwrap_or_default(),
        None,
    ) else {
        warn!("Ignoring invalid watch_root: {watch_root:?}");
        return;
    };

    if let Err(e) = state.watch_config_tx.send(WatchConfigUpdate {
        watch_root,
        ignore_paths,
        include_paths,
        scan_cancellation_token: CancellationToken::new_scan(),
    }) {
        error!("Failed to request watch config change: {e:?}");
    }
}

#[tauri::command]
pub async fn open_in_finder(path: String) {
    if let Err(e) = Command::new("open").arg("-R").arg(&path).spawn() {
        error!("Failed to reveal path in Finder: {e}");
    }
}

#[tauri::command]
pub async fn open_path(path: String) {
    if let Err(e) = Command::new("open").arg(&path).spawn() {
        error!("Failed to open path: {e}");
    }
}

/// Where a release asset is allowed to come from.
///
/// ponytail-keep: this prefix check is the whole security of the command below, which downloads a
/// file and mounts it. Without it, anything able to reach the command — a crafted response, a
/// future caller that forgets — could have the app mount an arbitrary disk image. The URL is only
/// ever supposed to come from this repository's own release assets, so require exactly that.
const RELEASE_ASSET_PREFIX: &str = "https://github.com/franciscoxc/cardinal/releases/download/";

/// Downloads a release asset and mounts it, so updating is one click from the update dialog.
///
/// Deliberately not an auto-updater: no signature manifest, no update channel, no silent replace.
/// It fetches the disk image the user just agreed to and opens it, leaving the drag to Applications
/// — and the decision — to them.
#[tauri::command(async)]
pub async fn download_and_mount_update(app: AppHandle, url: String) -> Result<String, String> {
    if !url.starts_with(RELEASE_ASSET_PREFIX) {
        error!("Refused to download an asset from outside the release URL: {url}");
        return Err("unexpected download location".into());
    }

    let name = url
        .rsplit('/')
        .next()
        .filter(|name| name.ends_with(".dmg") && !name.contains(['/', '\\']))
        .ok_or_else(|| "unexpected asset name".to_string())?
        .to_string();

    let target = app
        .path()
        .download_dir()
        .map_err(|e| format!("no Downloads folder: {e}"))?
        .join(&name);

    // curl rather than an HTTP crate: macOS ships it, the app already shells out to `open`, and a
    // whole client dependency tree to fetch one file is not worth carrying.
    let status = Command::new("curl")
        .args([
            "--fail",
            "--location",
            "--silent",
            "--show-error",
            "--proto",
            "=https",
            "--tlsv1.2",
            "--output",
        ])
        .arg(&target)
        .arg(&url)
        .status()
        .map_err(|e| format!("could not run curl: {e}"))?;

    if !status.success() {
        return Err(format!("download failed ({status})"));
    }

    // No `-nobrowse`: the volume has to be browsable, since the whole point is dragging the app out
    // of it. Its output is captured because it names the mount point, which is the only way to know
    // where to open the window.
    let mounted = Command::new("hdiutil")
        .arg("attach")
        .arg(&target)
        .output()
        .map_err(|e| format!("could not run hdiutil: {e}"))?;

    if !mounted.status.success() {
        return Err(format!(
            "could not mount the disk image ({})",
            String::from_utf8_lossy(&mounted.stderr).trim()
        ));
    }

    // hdiutil prints tab-separated columns and the mount point is the last one, on whichever line
    // actually got mounted — the earlier lines are the container partitions, which have none.
    let mount_point = String::from_utf8_lossy(&mounted.stdout)
        .lines()
        .filter_map(|line| line.rsplit('\t').next())
        .map(str::trim)
        .find(|field| field.starts_with("/Volumes/"))
        .map(str::to_string)
        .ok_or_else(|| "mounted, but hdiutil named no mount point".to_string())?;

    // ponytail-keep: mounting is not showing. `hdiutil attach` makes the volume browsable but does
    // not open anything, so the window to drag the app out of never appeared and the instruction to
    // drag it made no sense. Opening the mount point is what puts that window on screen.
    if let Err(e) = Command::new("open").arg(&mount_point).spawn() {
        error!("Mounted the update but could not show it in Finder: {e}");
    }

    info!("Update downloaded to {target:?} and mounted at {mount_point}");
    Ok(mount_point)
}

/// Quits the app the same way the menu does, flushing the cache on the way out.
///
/// Exists for the update flow: the new version cannot be dragged over the running one, so the
/// dialog that says to drag it has to be able to get out of the way.
#[tauri::command]
pub async fn quit_app(app: AppHandle) {
    info!("Quit requested to make way for an update");
    // Through Tauri rather than `process::exit`, so `RunEvent::ExitRequested` still runs and the
    // index is written to disk — otherwise the new version starts by rebuilding it from scratch.
    app.exit(0);
}

#[tauri::command]
pub async fn start_logic(
    watch_root: String,
    ignore_paths: Vec<String>,
    include_paths: Option<Vec<String>>,
) {
    if let Some(sender) = LOGIC_START.get() {
        let _ = sender.try_send(LogicStartConfig {
            watch_root,
            ignore_paths,
            include_paths: include_paths.unwrap_or_default(),
        });
    }
}

#[tauri::command]
pub async fn hide_main_window(app: AppHandle) {
    hide_main_window_impl(&app);
}

#[tauri::command]
pub async fn activate_main_window(app: AppHandle) {
    activate_main_window_impl(&app);
}

#[tauri::command]
pub async fn toggle_main_window(app: AppHandle) {
    toggle_main_window_impl(&app);
}

#[tauri::command]
pub async fn set_tray_activation_policy(app: AppHandle, enabled: bool) {
    let app_handle = app.clone();
    if let Err(e) = app.run_on_main_thread(move || {
        let policy = if enabled {
            ActivationPolicy::Accessory
        } else {
            ActivationPolicy::Regular
        };
        if let Err(e) = app_handle.set_activation_policy(policy) {
            error!("Failed to set activation policy: {e:?}");
        }
        activate_main_window_impl(&app_handle);
    }) {
        error!("Failed to dispatch activation policy update: {e:?}");
    }
}

#[tauri::command]
pub async fn copy_files_to_clipboard(paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }

    if let Err(err) = copy_files_to_clipboard_impl(paths) {
        error!("Failed to copy files to clipboard: {err:?}");
    }
}

fn copy_files_to_clipboard_impl(paths: Vec<String>) -> Result<()> {
    autoreleasepool(|_| unsafe {
        let pasteboard = NSPasteboard::generalPasteboard();
        pasteboard.clearContents();

        let urls: Vec<Retained<NSURL>> = paths
            .iter()
            .map(|path| NSURL::fileURLWithPath(&NSString::from_str(path)))
            .collect();

        let path_strings = NSPasteboardItem::new();
        {
            let ns_path = NSString::from_str(&paths.join(" "));
            path_strings.setString_forType(&ns_path, NSPasteboardTypeString);
        }

        let objects: Vec<&ProtocolObject<dyn NSPasteboardWriting>> = urls
            .iter()
            .map(|url| ProtocolObject::from_ref(&**url))
            .chain(Some(ProtocolObject::from_ref(&*path_strings)))
            .collect();
        let array = NSArray::from_slice(&objects);
        if pasteboard.writeObjects(&array) {
            Ok(())
        } else {
            Err(anyhow!("NSPasteboard.writeObjects failed"))
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_rejects_empty_input() {
        assert_eq!(normalize_path_input(""), None);
        assert_eq!(normalize_path_input("   "), None);
    }

    #[test]
    fn normalize_accepts_absolute_paths() {
        assert_eq!(normalize_path_input("/"), Some("/".to_string()));
        assert_eq!(
            normalize_path_input(" /var/log "),
            Some("/var/log".to_string())
        );
    }

    #[test]
    fn normalize_expands_tilde_when_home_available() {
        let Ok(home) = std::env::var("HOME") else {
            return;
        };
        assert_eq!(normalize_path_input("~"), Some(home.clone()));
        assert_eq!(
            normalize_path_input("~/Documents"),
            Some(format!("{home}/Documents"))
        );
    }

    #[test]
    fn normalize_rejects_relative_paths_and_tilde_users() {
        assert_eq!(normalize_path_input("relative/path"), None);
        assert_eq!(normalize_path_input("./relative"), None);
        assert_eq!(normalize_path_input("~someone"), None);
        assert_eq!(normalize_path_input("~someone/Documents"), None);
    }
}
