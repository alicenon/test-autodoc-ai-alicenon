import React, { useState } from 'react';
import { TreeNode } from '../types';
import { FolderIcon, FolderOpenIcon, FileIcon } from './Icons';

interface TreeItemProps {
  node: TreeNode;
  depth?: number;
  onSelect: (node: TreeNode) => void;
  selectedPath?: string | null;
}

export const TreeItem: React.FC<TreeItemProps> = ({ node, depth = 0, onSelect, selectedPath }) => {
  const [isOpen, setIsOpen] = useState(false);
  const hasChildren = node.type === 'tree' && node.children && node.children.length > 0;
  const isSelected = selectedPath === node.path;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.type === 'tree') {
      setIsOpen(!isOpen);
    } else {
      onSelect(node);
    }
  };

  // Indentation style
  const paddingLeft = `${depth * 1.25}rem`;

  return (
    <div className="select-none">
      <div
        className={`flex items-center py-1.5 px-2 cursor-pointer transition-colors duration-150 rounded-md border border-transparent ${
          isSelected 
            ? 'bg-blue-500/20 border-blue-500/30' 
            : 'hover:bg-slate-800'
        } ${isOpen && !isSelected ? 'bg-slate-800/30' : ''}`}
        style={{ paddingLeft: depth === 0 ? '0.5rem' : paddingLeft }}
        onClick={handleClick}
      >
        <span className="mr-2 text-slate-400 shrink-0">
          {node.type === 'tree' ? (
            isOpen ? <FolderOpenIcon className="w-4 h-4 text-yellow-500" /> : <FolderIcon className="w-4 h-4 text-yellow-500" />
          ) : (
            <FileIcon className={`w-4 h-4 ${isSelected ? 'text-blue-300' : 'text-blue-400'}`} />
          )}
        </span>
        <span className={`text-sm truncate ${
            isSelected ? 'text-blue-200 font-medium' : 
            node.type === 'tree' ? 'font-medium text-slate-200' : 'text-slate-400'
        }`}>
          {node.name}
        </span>
      </div>

      {isOpen && hasChildren && (
        <div className="flex flex-col border-l border-slate-800 ml-[calc(1rem+3px)]">
          {node.children!.map((child) => (
            <TreeItem 
                key={child.path} 
                node={child} 
                depth={depth + 1} 
                onSelect={onSelect}
                selectedPath={selectedPath}
            />
          ))}
        </div>
      )}
    </div>
  );
};