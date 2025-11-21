import React, { useState, useCallback, useEffect } from 'react';
// @ts-ignore
import JSZip from 'jszip';

import { parseRepoUrl, fetchRepoDetails, fetchBranches, fetchTree, buildTreeStructure, fetchFileContent, setGitHubToken, getGitHubToken, removeGitHubToken } from './services/github';
import { analyzeRepoArchitecture, generateCodeDocumentation } from './services/gemini';
import { AppState, GitHubBranch, GitHubTreeItem, RepoDetails, TreeNode } from './types';
import { TreeItem } from './components/TreeItem';
import { SearchIcon, LoaderIcon, GitBranchIcon, StarIcon, SparklesIcon, FileIcon, DownloadIcon, CloseIcon, SettingsIcon, CheckSquareIcon, SquareIcon } from './components/Icons';

// Helper for export candidates
interface ExportFileCandidate {
    path: string;
    sha: string;
    selected: boolean;
}

const App: React.FC = () => {
  const [urlInput, setUrlInput] = useState('');
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hasToken, setHasToken] = useState(false);
  
  const [repoDetails, setRepoDetails] = useState<RepoDetails | null>(null);
  const [branches, setBranches] = useState<GitHubBranch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [allItems, setAllItems] = useState<GitHubTreeItem[]>([]);
  
  // Analysis States
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Documentation States
  const [activeTab, setActiveTab] = useState<'overview' | 'docs'>('overview');
  const [selectedFile, setSelectedFile] = useState<TreeNode | null>(null);
  const [fileDoc, setFileDoc] = useState<string | null>(null);
  const [isGeneratingDoc, setIsGeneratingDoc] = useState(false);

  // Export States
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState<'markdown' | 'html'>('markdown');
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState({ current: 0, total: 0, currentFile: '' });
  const [exportCandidates, setExportCandidates] = useState<ExportFileCandidate[]>([]);

  // Settings State
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [tokenInput, setTokenInput] = useState('');

  useEffect(() => {
      const token = getGitHubToken();
      if (token) {
          setHasToken(true);
          setTokenInput(token);
      }
  }, []);

  const handleFetchRepo = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!urlInput.trim()) return;

    const parsed = parseRepoUrl(urlInput);
    if (!parsed) {
      setErrorMsg('Invalid GitHub URL. Please use "owner/repo" format (e.g. facebook/react)');
      return;
    }

    setAppState(AppState.LOADING_REPO);
    setErrorMsg(null);
    setRepoDetails(null);
    setBranches([]);
    setTreeData([]);
    setAllItems([]);
    setAiAnalysis(null);
    setFileDoc(null);
    setSelectedFile(null);
    setActiveTab('overview');

    try {
      const details = await fetchRepoDetails(parsed.owner, parsed.repo);
      setRepoDetails(details);
      
      const branchList = await fetchBranches(parsed.owner, parsed.repo);
      setBranches(branchList);
      
      if (branchList.length > 0) {
        const defaultB = branchList.find(b => b.name === details.default_branch) || branchList[0];
        setSelectedBranch(defaultB.name);
        fetchRepoTree(parsed.owner, parsed.repo, defaultB.name);
      } else {
        setAppState(AppState.SELECTING_BRANCH);
      }

    } catch (err: any) {
      setAppState(AppState.ERROR);
      setErrorMsg(err.message || 'Failed to fetch repository data.');
    }
  }, [urlInput]);

  const fetchRepoTree = async (owner: string, repo: string, branchName: string) => {
    setAppState(AppState.LOADING_TREE);
    try {
        const branch = branches.find(b => b.name === branchName);
        if(!branch) throw new Error("Branch not found");

        const rawTree = await fetchTree(owner, repo, branch.commit.sha);
        setAllItems(rawTree);

        const structuredTree = buildTreeStructure(rawTree);
        setTreeData(structuredTree);
        
        const paths = rawTree.map(t => t.path);
        setAppState(AppState.VIEWING);

        setIsAnalyzing(true);
        analyzeRepoArchitecture(paths).then(analysis => {
            setAiAnalysis(analysis);
            setIsAnalyzing(false);
        });

    } catch (err: any) {
        setAppState(AppState.ERROR);
        setErrorMsg(err.message || 'Failed to load file tree.');
    }
  };

  const handleBranchChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newBranch = e.target.value;
    setSelectedBranch(newBranch);
    if (repoDetails) {
        fetchRepoTree(repoDetails.owner, repoDetails.name, newBranch);
    }
  };

  const handleFileSelect = async (node: TreeNode) => {
      if (node.type !== 'blob') return;
      if (node.path === selectedFile?.path) return;

      setSelectedFile(node);
      setActiveTab('docs');
      setFileDoc(null);
      setIsGeneratingDoc(true);

      try {
          if (!repoDetails) return;
          const content = await fetchFileContent(repoDetails.owner, repoDetails.name, node.path, selectedBranch, node.sha);
          const doc = await generateCodeDocumentation(node.name, content);
          setFileDoc(doc);
      } catch (error: any) {
          setFileDoc(`Error generating docs: ${error.message}`);
      } finally {
          setIsGeneratingDoc(false);
      }
  };

  // Settings Logic
  const handleSaveToken = () => {
      setGitHubToken(tokenInput);
      setHasToken(true);
      setShowSettingsModal(false);
      // Reload repo if in error state due to rate limit?
      if (appState === AppState.ERROR && errorMsg?.includes('Rate Limit')) {
          handleFetchRepo();
      }
  };

  const handleClearToken = () => {
      removeGitHubToken();
      setTokenInput('');
      setHasToken(false);
      setShowSettingsModal(false);
  };

  // Export Logic with Preview/Selection
  const handleOpenExport = () => {
      // Identify interesting files
      const interestingExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rb', '.php', '.c', '.cpp', '.h', '.cs', '.rs', '.json', '.md', '.html', '.css'];
      
      // Limit to top 30 candidates to prevent overwhelming UI
      const candidates = allItems
          .filter(item => item.type === 'blob' && interestingExtensions.some(ext => item.path.endsWith(ext)))
          .slice(0, 30)
          .map(item => ({
              path: item.path,
              sha: item.sha,
              selected: true // Default to selected
          }));
      
      setExportCandidates(candidates);
      setShowExportModal(true);
  };

  const toggleExportFile = (path: string) => {
      setExportCandidates(prev => prev.map(c => 
          c.path === path ? { ...c, selected: !c.selected } : c
      ));
  };

  const wrapInHtml = (title: string, content: string) => {
      return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>${title} - Documentation</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
      body { font-family: 'Inter', sans-serif; background-color: #0f172a; color: #e2e8f0; padding: 40px; }
      .prose h1 { color: #f8fafc; font-size: 2.25rem; font-weight: 700; margin-bottom: 1rem; border-bottom: 1px solid #1e293b; padding-bottom: 0.5rem; }
      .prose h2 { color: #e0e7ff; font-size: 1.5rem; font-weight: 700; margin-top: 2rem; margin-bottom: 1rem; }
      .prose h3 { color: #bfdbfe; font-size: 1.25rem; font-weight: 600; margin-top: 1.5rem; margin-bottom: 0.75rem; }
      .prose ul { list-style-type: disc; padding-left: 1.5rem; color: #cbd5e1; }
      .prose li { margin-bottom: 0.5rem; }
      .prose strong { color: #f1f5f9; font-weight: 600; }
      .prose code { background-color: #1e293b; padding: 0.2rem 0.4rem; rounded: 0.25rem; font-family: monospace; color: #94a3b8; font-size: 0.875rem; }
      .prose pre { background-color: #020617; padding: 1rem; rounded: 0.5rem; overflow-x: auto; border: 1px solid #1e293b; margin-top: 1rem; margin-bottom: 1rem; }
    </style>
</head>
<body>
    <div class="max-w-4xl mx-auto prose">
        ${renderMarkdownString(content)}
    </div>
</body>
</html>
      `;
  };
  
  const renderMarkdownString = (md: string) => {
      return md
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^\- \*\*(.*)\*\*: (.*$)/gim, '<li><strong>$1:</strong> $2</li>')
        .replace(/^\- (.*$)/gim, '<li>$1</li>')
        .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
        .replace(/\n/g, '<br />');
  };

  const saveBlob = (blob: Blob, filename: string) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  };

  const handleExportDocs = async () => {
      if (!repoDetails || !branches.length) return;
      
      const filesToProcess = exportCandidates.filter(c => c.selected);
      if (filesToProcess.length === 0) {
          alert("Please select at least one file to export.");
          return;
      }

      setIsExporting(true);
      setExportProgress({ current: 0, total: filesToProcess.length, currentFile: 'Starting...' });
      
      const zip = new JSZip();
      const rootFolder = zip.folder(`${repoDetails.name}-docs`);

      try {
          for (let i = 0; i < filesToProcess.length; i++) {
              const item = filesToProcess[i];
              setExportProgress({ current: i + 1, total: filesToProcess.length, currentFile: item.path });
              
              try {
                const content = await fetchFileContent(repoDetails.owner, repoDetails.name, item.path, selectedBranch, item.sha);
                const docMd = await generateCodeDocumentation(item.path.split('/').pop()!, content);
                
                let fileContent = docMd;
                let extension = '.md';
                
                if (exportFormat === 'html') {
                    fileContent = wrapInHtml(item.path, docMd);
                    extension = '.html';
                }
                
                rootFolder?.file(`${item.path.replace(/\//g, '_')}${extension}`, fileContent);
                // Tiny delay to allow UI updates
                await new Promise(r => setTimeout(r, 100));
              } catch (err) {
                console.error(`Skipping file ${item.path}`, err);
              }
          }
          
          setExportProgress(prev => ({ ...prev, currentFile: 'Compressing ZIP...' }));
          const content = await zip.generateAsync({ type: "blob" });
          saveBlob(content, `${repoDetails.name}-documentation.zip`);
          
          setShowExportModal(false);
      } catch (e: any) {
          alert(`Export Error: ${e.message}`);
      } finally {
          setIsExporting(false);
      }
  };

  const renderHeader = () => (
    <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-20">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => setAppState(AppState.IDLE)}>
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-cyan-400 rounded-lg flex items-center justify-center text-slate-900 font-bold text-xl shadow-lg shadow-blue-500/20">
                <a href="https://github.com/alicenon" target="_blank">Me</a>
            </div>
            <h1 className="text-lg font-semibold bg-clip-text text-transparent bg-gradient-to-r from-slate-100 to-slate-400">
                Test Autodoc Gen
            </h1>
        </div>
        <div className="flex items-center gap-3">
            {appState === AppState.VIEWING && (
                <button 
                    onClick={handleOpenExport}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors shadow-lg shadow-blue-900/20"
                >
                    <DownloadIcon className="w-4 h-4" />
                    <span className="hidden sm:inline">Export Docs</span>
                </button>
            )}
            <button
                onClick={() => setShowSettingsModal(true)}
                className={`p-2 rounded-lg transition-colors ${hasToken ? 'text-green-400 bg-green-400/10 hover:bg-green-400/20' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
                title="API Settings"
            >
                <SettingsIcon className="w-5 h-5" />
            </button>
        </div>
      </div>
    </header>
  );

  const renderRepoInfo = () => {
    if (!repoDetails) return null;

    return (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 bg-slate-900/50 border border-slate-800 p-4 rounded-xl backdrop-blur-sm animate-fade-in">
            <div className="overflow-hidden">
                <h2 className="text-xl font-bold text-white flex items-center gap-2 truncate">
                    <span className="text-slate-400 font-normal hover:text-white transition-colors cursor-pointer" onClick={() => window.open(`https://github.com/${repoDetails.owner}`, '_blank')}>
                        {repoDetails.owner}
                    </span>
                    <span className="text-slate-600">/</span>
                    <span className="hover:text-blue-400 transition-colors cursor-pointer" onClick={() => window.open(`https://github.com/${repoDetails.owner}/${repoDetails.name}`, '_blank')}>
                        {repoDetails.name}
                    </span>
                </h2>
                <p className="text-slate-400 text-sm mt-1 truncate pr-4">
                    {repoDetails.description || "No description available."}
                </p>
            </div>

            <div className="flex items-center gap-3 shrink-0">
                <div className="flex items-center gap-1.5 text-slate-300 text-sm bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 shadow-sm">
                    <StarIcon className="w-4 h-4 text-yellow-500" />
                    <span>{repoDetails.stars.toLocaleString()}</span>
                </div>
                
                <div className="flex items-center gap-1.5 text-slate-300 text-sm bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 shadow-sm hover:border-slate-700 transition-colors relative">
                    <GitBranchIcon className="w-4 h-4 text-blue-400" />
                    <select 
                        value={selectedBranch} 
                        onChange={handleBranchChange}
                        className="bg-transparent outline-none appearance-none cursor-pointer pr-4 w-full text-center"
                    >
                        {branches.map(b => (
                            <option key={b.name} value={b.name} className="bg-slate-900 text-slate-300">
                                {b.name}
                            </option>
                        ))}
                    </select>
                </div>
            </div>
        </div>
    );
  };

  const renderMarkdown = (content: string) => (
    <div className="prose prose-invert prose-sm max-w-none">
        {content.split('\n').map((line, i) => {
            if(line.startsWith('# ')) return <h1 key={i} className="text-2xl font-bold text-white mb-4 mt-6 border-b border-slate-800 pb-2">{line.replace('# ', '')}</h1>
            if(line.startsWith('## ')) return <h2 key={i} className="text-xl font-bold text-blue-100 mb-3 mt-5">{line.replace('## ', '')}</h2>
            if(line.startsWith('### ')) return <h3 key={i} className="text-lg font-semibold text-blue-200 mb-2 mt-4">{line.replace('### ', '')}</h3>
            if(line.startsWith('- **')) {
                const parts = line.split('**:');
                return <li key={i} className="ml-4 text-slate-300 list-disc mb-1"><span className="font-bold text-slate-100">{parts[0].replace('- **', '')}:</span>{parts[1]}</li>
            }
            if(line.startsWith('-')) return <li key={i} className="ml-4 text-slate-300 list-disc mb-1">{line.replace('-', '')}</li>
            if(line.startsWith('```')) return <div key={i} className="my-2 bg-slate-950 rounded border border-slate-800 p-2 text-xs font-mono text-slate-400 opacity-50">Code Snippet</div>
            if(line.trim() === '') return <br key={i} />
            return <p key={i} className="text-slate-400 mb-2 leading-relaxed">{line}</p>
        })}
    </div>
  );

  const renderRightPanel = () => (
      <div className="bg-slate-900 border border-slate-800 rounded-xl flex flex-col h-full overflow-hidden">
          <div className="flex border-b border-slate-800 bg-slate-900/50">
              <button 
                  onClick={() => setActiveTab('overview')}
                  className={`flex-1 py-3 text-sm font-medium transition-colors border-b-2 ${
                      activeTab === 'overview' 
                      ? 'border-purple-500 text-purple-400 bg-purple-500/5' 
                      : 'border-transparent text-slate-500 hover:text-slate-300'
                  }`}
              >
                  Architecture Overview
              </button>
              <button 
                  onClick={() => setActiveTab('docs')}
                  className={`flex-1 py-3 text-sm font-medium transition-colors border-b-2 ${
                      activeTab === 'docs' 
                      ? 'border-blue-500 text-blue-400 bg-blue-500/5' 
                      : 'border-transparent text-slate-500 hover:text-slate-300'
                  }`}
              >
                  File Docs {selectedFile ? `(${selectedFile.name})` : ''}
              </button>
          </div>

          <div className="p-6 flex-1 overflow-auto custom-scrollbar">
              {activeTab === 'overview' ? (
                  <>
                      <div className="flex items-center gap-2 mb-4 text-purple-400 font-semibold">
                          <SparklesIcon className="w-5 h-5" />
                          <h3>Gemini Architecture Analysis</h3>
                      </div>
                      
                      {isAnalyzing ? (
                          <div className="flex flex-col items-center justify-center h-48 text-slate-500 gap-3 animate-pulse">
                              <div className="w-8 h-8 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin"></div>
                              <p className="text-sm">Analyzing project structure...</p>
                          </div>
                      ) : aiAnalysis ? (
                          renderMarkdown(aiAnalysis)
                      ) : (
                          <div className="text-slate-500 text-sm text-center mt-10">
                              Analysis not available.
                          </div>
                      )}
                  </>
              ) : (
                  <>
                      {!selectedFile ? (
                          <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-4">
                              <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center opacity-50">
                                  <FileIcon className="w-8 h-8" />
                              </div>
                              <p className="max-w-xs text-center">Select a file from the tree to generate autodocs.</p>
                          </div>
                      ) : isGeneratingDoc ? (
                          <div className="flex flex-col items-center justify-center h-48 text-slate-500 gap-3 animate-pulse">
                              <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
                              <p className="text-sm">Reading {selectedFile.name} & generating docs...</p>
                          </div>
                      ) : fileDoc ? (
                          <div className="animate-fade-in">
                              <div className="flex items-center justify-between mb-4 pb-4 border-b border-slate-800">
                                  <div className="flex items-center gap-2 text-blue-400 font-semibold">
                                      <SparklesIcon className="w-5 h-5" />
                                      <h3>Auto-Generated Docs</h3>
                                  </div>
                                  <span className="text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded">
                                      {selectedFile.path}
                                  </span>
                              </div>
                              {renderMarkdown(fileDoc)}
                          </div>
                      ) : (
                          <div className="text-slate-500 text-sm text-center">
                              Could not generate documentation.
                          </div>
                      )}
                  </>
              )}
          </div>
      </div>
  );

  const renderSettingsModal = () => {
      if (!showSettingsModal) return null;
      return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in">
              <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
                  <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-800/50">
                      <h3 className="text-white font-semibold flex items-center gap-2">
                          <SettingsIcon className="w-5 h-5 text-green-400" />
                          GitHub API Settings
                      </h3>
                      <button onClick={() => setShowSettingsModal(false)} className="text-slate-400 hover:text-white">
                          <CloseIcon className="w-5 h-5" />
                      </button>
                  </div>
                  <div className="p-6">
                    <p className="text-slate-300 text-sm mb-4">
                        Add a GitHub Personal Access Token (PAT) to increase API rate limits from 60 to 5,000 requests per hour.
                    </p>
                    
                    <div className="bg-blue-900/20 border border-blue-500/20 rounded-lg p-3 mb-6 text-xs text-blue-200">
                        <strong>Security Note:</strong> Your token is saved only in your browser's local storage and is never sent to any other server.
                    </div>

                    <div className="mb-6">
                        <label className="block text-xs text-slate-500 font-semibold uppercase mb-2">Personal Access Token</label>
                        <input 
                            type="password"
                            value={tokenInput}
                            onChange={(e) => setTokenInput(e.target.value)}
                            placeholder="ghp_xxxxxxxxxxxx"
                            className="w-full p-3 bg-slate-950 border border-slate-800 rounded-lg text-white focus:border-green-500 focus:outline-none font-mono text-sm"
                        />
                    </div>

                    <div className="flex gap-3">
                        <button 
                            onClick={handleSaveToken}
                            className="flex-1 py-2.5 bg-green-600 hover:bg-green-500 text-white font-semibold rounded-lg shadow-lg shadow-green-900/20 transition-all"
                        >
                            Save Token
                        </button>
                        {hasToken && (
                            <button 
                                onClick={handleClearToken}
                                className="px-4 py-2.5 bg-slate-800 hover:bg-red-900/30 text-slate-300 hover:text-red-400 font-medium rounded-lg transition-all border border-slate-700 hover:border-red-900/50"
                            >
                                Remove
                            </button>
                        )}
                    </div>
                  </div>
              </div>
          </div>
      );
  };

  const renderExportModal = () => {
      if (!showExportModal) return null;
      return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
              <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]">
                  <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-800/50 shrink-0">
                      <h3 className="text-white font-semibold flex items-center gap-2">
                          <DownloadIcon className="w-5 h-5 text-blue-400" />
                          Export Documentation
                      </h3>
                      <button onClick={() => !isExporting && setShowExportModal(false)} className="text-slate-400 hover:text-white">
                          <CloseIcon className="w-5 h-5" />
                      </button>
                  </div>
                  
                  {!isExporting ? (
                      <>
                        <div className="p-6 overflow-y-auto custom-scrollbar">
                            <p className="text-slate-300 text-sm mb-4">
                                Select files to include in the auto-generated documentation package. 
                                <span className="text-slate-500 block mt-1 text-xs">(Showing top 30 code files detected)</span>
                            </p>
                            
                            <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-2 max-h-60 overflow-y-auto border border-slate-800 rounded-lg p-2 bg-slate-950">
                                {exportCandidates.map((item) => (
                                    <div 
                                        key={item.path} 
                                        onClick={() => toggleExportFile(item.path)}
                                        className={`flex items-center gap-3 p-2 rounded cursor-pointer select-none transition-colors ${
                                            item.selected ? 'bg-blue-900/20 hover:bg-blue-900/30' : 'hover:bg-slate-900'
                                        }`}
                                    >
                                        {item.selected ? (
                                            <CheckSquareIcon className="w-5 h-5 text-blue-400 shrink-0" />
                                        ) : (
                                            <SquareIcon className="w-5 h-5 text-slate-600 shrink-0" />
                                        )}
                                        <span className={`text-sm truncate ${item.selected ? 'text-blue-100' : 'text-slate-500'}`}>
                                            {item.path}
                                        </span>
                                    </div>
                                ))}
                            </div>

                            <div className="mb-2">
                                <label className="block text-xs text-slate-500 font-semibold uppercase mb-2">Format</label>
                                <div className="grid grid-cols-2 gap-3">
                                    <button 
                                        onClick={() => setExportFormat('markdown')}
                                        className={`p-3 rounded-lg border text-sm font-medium transition-colors ${
                                            exportFormat === 'markdown' 
                                            ? 'bg-blue-600 border-blue-500 text-white' 
                                            : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                                        }`}
                                    >
                                        Markdown (.md)
                                    </button>
                                    <button 
                                        onClick={() => setExportFormat('html')}
                                        className={`p-3 rounded-lg border text-sm font-medium transition-colors ${
                                            exportFormat === 'html' 
                                            ? 'bg-blue-600 border-blue-500 text-white' 
                                            : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                                        }`}
                                    >
                                        HTML (.html)
                                    </button>
                                </div>
                            </div>
                        </div>
                        
                        <div className="p-4 border-t border-slate-800 bg-slate-900/50 shrink-0">
                            <button 
                                onClick={handleExportDocs}
                                className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold rounded-lg shadow-lg shadow-blue-900/20 transition-all"
                            >
                                Generate & Download ZIP ({exportCandidates.filter(c => c.selected).length})
                            </button>
                        </div>
                      </>
                  ) : (
                      <div className="p-12 flex flex-col items-center justify-center h-full">
                          <div className="w-full max-w-xs mb-6">
                                <div className="relative h-2 bg-slate-800 rounded-full overflow-hidden">
                                    <div 
                                        className="absolute top-0 left-0 h-full bg-blue-500 transition-all duration-300"
                                        style={{ width: `${(exportProgress.current / exportProgress.total) * 100}%` }}
                                    ></div>
                                </div>
                          </div>
                          <div className="flex items-center justify-center gap-2 text-blue-400 font-medium mb-2">
                              <LoaderIcon className="w-5 h-5 animate-spin" />
                              <span className="text-lg">Processing {exportProgress.current} / {exportProgress.total}</span>
                          </div>
                          <p className="text-sm text-slate-500 truncate max-w-sm text-center">
                              {exportProgress.currentFile}
                          </p>
                      </div>
                  )}
              </div>
          </div>
      );
  };

  return (
    <div className="min-h-screen bg-[#0f172a] pb-20">
      {renderHeader()}
      {renderSettingsModal()}
      {renderExportModal()}
      
      <main className="max-w-7xl mx-auto px-4">
        {appState === AppState.IDLE || appState === AppState.LOADING_REPO || appState === AppState.ERROR ? (
            <div className="max-w-2xl mx-auto mt-12 mb-8 px-4 animate-fade-in">
                <div className="text-center mb-8">
                    <h2 className="text-3xl sm:text-4xl font-bold mb-3 text-white tracking-tight">
                        Visualize Any Repository
                    </h2>
                    <p className="text-slate-400 text-lg">
                        Enter a GitHub URL to generate file trees, architecture analysis, and 
                        <span className="text-blue-400 font-medium"> automatic documentation</span>.
                    </p>
                </div>
                
                <form onSubmit={handleFetchRepo} className="relative group">
                    <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl opacity-50 group-hover:opacity-100 transition duration-500 blur"></div>
                    <div className="relative flex items-center bg-slate-900 rounded-xl overflow-hidden shadow-2xl">
                        <SearchIcon className="absolute left-4 w-5 h-5 text-slate-500" />
                        <input 
                            type="text"
                            value={urlInput}
                            onChange={(e) => setUrlInput(e.target.value)}
                            placeholder="e.g. facebook/react or https://github.com/..."
                            className="w-full py-4 pl-12 pr-32 bg-transparent text-white placeholder-slate-500 focus:outline-none text-lg"
                        />
                        <button 
                            type="submit"
                            disabled={appState === AppState.LOADING_REPO}
                            className="absolute right-2 top-2 bottom-2 bg-slate-800 hover:bg-slate-700 text-white px-4 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                        >
                            {appState === AppState.LOADING_REPO ? (
                                <LoaderIcon className="animate-spin w-4 h-4" />
                            ) : (
                                "Analyze"
                            )}
                        </button>
                    </div>
                </form>
                
                {errorMsg && (
                    <div className="mt-6 p-4 bg-red-950/50 border border-red-500/30 text-red-200 rounded-xl text-center shadow-lg animate-fade-in flex flex-col items-center justify-center gap-2">
                        <div className="flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            <span className="font-medium">{errorMsg}</span>
                        </div>
                        {errorMsg.includes("Rate Limit") && (
                            <button onClick={() => setShowSettingsModal(true)} className="text-sm underline text-red-300 hover:text-white mt-1">
                                Open Settings to add API Token
                            </button>
                        )}
                    </div>
                )}
            </div>
        ) : (
            <div className="mt-8 animate-fade-in">
                <div className="flex items-center justify-between mb-6">
                    <button onClick={() => setAppState(AppState.IDLE)} className="text-sm text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1">
                        ← <span className="hover:underline">Analyze another repository</span>
                    </button>
                </div>

                {renderRepoInfo()}
                
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[650px]">
                    <div className="lg:col-span-1 bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
                        <div className="p-3 border-b border-slate-800 bg-slate-900/80 text-xs font-medium text-slate-500 uppercase tracking-wider flex justify-between items-center">
                           <span>Explorer</span>
                           {appState === AppState.LOADING_TREE && <LoaderIcon className="w-3 h-3 animate-spin" />}
                        </div>
                        <div className="flex-1 overflow-auto p-2 custom-scrollbar">
                            {treeData.length === 0 && appState !== AppState.LOADING_TREE ? (
                                <div className="text-center text-slate-500 mt-10">No files found.</div>
                            ) : (
                                <div className="space-y-0.5">
                                    {treeData.map(node => (
                                        <TreeItem 
                                            key={node.path} 
                                            node={node} 
                                            onSelect={handleFileSelect}
                                            selectedPath={selectedFile?.path}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="lg:col-span-2 h-full">
                        {renderRightPanel()}
                    </div>
                </div>
            </div>
        )}
      </main>
    </div>
  );
};

export default App;