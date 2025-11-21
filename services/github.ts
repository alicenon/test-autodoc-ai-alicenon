import { GitHubBranch, GitHubTreeItem, RepoDetails, TreeNode } from '../types';

const BASE_URL = 'https://api.github.com';
const TOKEN_KEY = 'github_pat';

// --- Token Management ---
export const setGitHubToken = (token: string) => {
    if (token) {
        localStorage.setItem(TOKEN_KEY, token);
    }
};

export const getGitHubToken = (): string | null => {
    return localStorage.getItem(TOKEN_KEY);
};

export const removeGitHubToken = () => {
    localStorage.removeItem(TOKEN_KEY);
};

// --- Private Fetch Wrapper ---
const githubFetch = async (url: string, options: RequestInit = {}) => {
    const token = getGitHubToken();
    const headers = {
        ...options.headers,
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        'Accept': 'application/vnd.github.v3+json',
    };

    const response = await fetch(url, { ...options, headers });
    return response;
};

export const parseRepoUrl = (input: string): { owner: string; repo: string } | null => {
  try {
    let url = input.trim();
    
    // Remove .git extension if present
    if (url.endsWith('.git')) {
      url = url.slice(0, -4);
    }
    
    // Remove trailing slash
    if (url.endsWith('/')) {
      url = url.slice(0, -1);
    }

    // Case 1: "owner/repo"
    const simplePattern = /^[a-zA-Z0-9-]+\/[a-zA-Z0-9-_.]+$/;
    if (simplePattern.test(url)) {
      const [owner, repo] = url.split('/');
      return { owner, repo };
    }

    // Case 2: Full URL
    // Ensure protocol for URL constructor
    if (!url.startsWith('http')) {
        if (url.includes('github.com')) {
            url = 'https://' + url;
        } else {
             // Fallback for malformed simple strings like "owner/repo" that failed regex
            const parts = url.split('/');
            if (parts.length === 2) return { owner: parts[0], repo: parts[1] };
        }
    }

    const urlObj = new URL(url);
    if (urlObj.hostname.includes('github.com')) {
        const pathParts = urlObj.pathname.split('/').filter(Boolean);
        if (pathParts.length >= 2) {
            return { owner: pathParts[0], repo: pathParts[1] };
        }
    }

    return null;
  } catch (e) {
    console.error("URL Parse Error:", e);
    return null;
  }
};

const handleApiResponse = async (response: Response) => {
    if (response.ok) return response.json();
    
    if (response.status === 403 || response.status === 429) {
        // Check headers for rate limit info if possible, but mainly assume limit
        throw new Error("GitHub API Rate Limit Exceeded. Please configure a Token in settings or wait an hour.");
    }
    
    if (response.status === 404) {
        throw new Error("Repository not found or is private (Check your Token if private).");
    }

    if (response.status === 401) {
        throw new Error("Bad Credentials. Please check your GitHub Token in settings.");
    }

    throw new Error(`GitHub API Error: ${response.status} ${response.statusText}`);
};

export const fetchRepoDetails = async (owner: string, repo: string): Promise<RepoDetails> => {
  const response = await githubFetch(`${BASE_URL}/repos/${owner}/${repo}`);
  const data = await handleApiResponse(response);
  
  return {
    owner: data.owner.login,
    name: data.name,
    description: data.description,
    stars: data.stargazers_count,
    forks: data.forks_count,
    default_branch: data.default_branch,
  };
};

export const fetchBranches = async (owner: string, repo: string): Promise<GitHubBranch[]> => {
  const response = await githubFetch(`${BASE_URL}/repos/${owner}/${repo}/branches`);
  return handleApiResponse(response);
};

export const fetchTree = async (owner: string, repo: string, sha: string): Promise<GitHubTreeItem[]> => {
  const response = await githubFetch(`${BASE_URL}/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`);
  const data = await handleApiResponse(response);
  
  if (data.truncated) {
    console.warn('Tree is truncated due to size.');
  }
  return data.tree;
};

export const fetchFileContent = async (owner: string, repo: string, path: string, ref: string, sha?: string): Promise<string> => {
  const decodeContent = (str: string) => {
      try {
          // Use TextDecoder for proper UTF-8 handling
          const binaryString = atob(str.replace(/\n/g, ''));
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
          }
          return new TextDecoder('utf-8').decode(bytes);
      } catch (e) {
          // Fallback
          return atob(str.replace(/\n/g, ''));
      }
  };

  // Strategy 1: Try standard Contents API
  try {
    const response = await githubFetch(`${BASE_URL}/repos/${owner}/${repo}/contents/${path}?ref=${ref}`);
    if (response.ok) {
        const data = await response.json();
        if (!Array.isArray(data) && data.content) {
            return decodeContent(data.content);
        }
    } else if (response.status === 403 || response.status === 429) {
        // Propagate rate limits immediately
        throw new Error("Rate Limit Exceeded");
    }
  } catch (e: any) {
    if (e.message.includes("Rate Limit")) throw e;
    console.warn(`Contents API failed for ${path}, trying Blob API fallback.`);
  }

  // Strategy 2: Git Blob API
  if (sha) {
      try {
        const response = await githubFetch(`${BASE_URL}/repos/${owner}/${repo}/git/blobs/${sha}`);
        if (response.ok) {
            const data = await response.json();
            if (data.content && data.encoding === 'base64') {
                return decodeContent(data.content);
            }
        } else if (response.status === 403 || response.status === 429) {
            throw new Error("Rate Limit Exceeded");
        }
      } catch (e: any) {
         if (e.message.includes("Rate Limit")) throw e;
         console.error(`Blob API failed for ${path}`);
      }
  }

  throw new Error('Failed to fetch content (File too large or API limit reached).');
};

export const buildTreeStructure = (items: GitHubTreeItem[]): TreeNode[] => {
  const root: TreeNode[] = [];
  const map: Record<string, TreeNode> = {};

  items.sort((a, b) => {
    if (a.type === b.type) return a.path.localeCompare(b.path);
    return a.type === 'tree' ? -1 : 1;
  });

  items.forEach((item) => {
    const parts = item.path.split('/');
    const fileName = parts.pop()!;
    const parentPath = parts.join('/');
    
    const node: TreeNode = {
      name: fileName,
      path: item.path,
      type: item.type,
      sha: item.sha,
      children: item.type === 'tree' ? [] : undefined,
    };

    map[item.path] = node;

    if (parts.length === 0) {
      root.push(node);
    } else {
      if (map[parentPath]) {
        map[parentPath].children?.push(node);
      } else {
        root.push(node); 
      }
    }
  });

  return root;
};