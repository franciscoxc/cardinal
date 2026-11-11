export type SearchResultMetadata = Readonly<{
  type: number;
  size: number;
  mtime: number;
  ctime: number;
}>;

export type SearchResultItem = Readonly<{
  path: string;
  metadata?: SearchResultMetadata;
  size?: number;
  mtime?: number;
  ctime?: number;
  icon?: string;
  contentContext?: string;
  folderSize?: number;
  /** The folder total is a lower bound: something under it is unreadable or excluded. */
  folderSizeIncomplete?: boolean;
}>;

export type NodeInfoResponse = Readonly<{
  path: string;
  icon?: string | null;
  metadata?: SearchResultMetadata | null;
  size?: number | null;
  mtime?: number | null;
  ctime?: number | null;
  contentContext?: string | null;
}>;

/** What `get_folder_sizes` answers: one entry per index asked for, in the same order. */
export type FolderSizesResponse = Readonly<{
  /** `null` for anything that is not a folder, or that was not reached. */
  sizes: readonly (Readonly<{ bytes: number; incomplete: boolean }> | null)[];
  /** A newer request for rows took over first: whatever has no total yet is worth asking again. */
  interrupted: boolean;
}>;
