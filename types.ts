export interface GitHubBranch {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
}

export interface GitHubTreeItem {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url: string;
}

export interface TreeNode {
  name: string;
  path: string;
  type: 'blob' | 'tree';
  sha?: string;
  children?: TreeNode[];
}

export interface RepoDetails {
  owner: string;
  name: string;
  description: string;
  stars: number;
  forks: number;
  default_branch: string;
}

export enum AppState {
  IDLE,
  LOADING_REPO,
  SELECTING_BRANCH,
  LOADING_TREE,
  VIEWING,
  ERROR
}