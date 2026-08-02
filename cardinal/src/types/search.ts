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
  folderSize?: number | null;
  folderSizeIncomplete?: boolean | null;
}>;
