/* eslint-disable no-unused-vars */

///files?page=${page}&path=${pathname}${searchString}${sortString}${filterString}
declare interface FetchFilesParams {
  page: number | 0;
  path: string;
  search: string | undefined;
  sortBy: string | undefined;
  sortOrder: "asc" | "desc" | undefined;
  filter: string | undefined;
}

type ExploreFile = {
  name: string;
  path: string;
  size: number;
  type: string;
  lastUpdate: string;
};

type ExploreFilePageData = {
  docs: ExploreFile[];
  pageCount: number;
  docCount: number;
};
