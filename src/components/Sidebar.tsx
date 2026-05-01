import React from 'react';
import { Menu, Clipboard, Folder, Activity, User, Settings } from 'lucide-react';

const tools = [
  { icon: Menu, label: '菜单' },
  { icon: Clipboard, label: '剪贴板' },
  { icon: Folder, label: '文件管理' },
  { icon: Activity, label: '系统监控' },
  { icon: User, label: '用户' },
  { icon: Settings, label: '设置' },
];

export default function Sidebar() {
  return (
    <div className="w-10 flex-shrink-0 bg-terminal-surface border-r border-terminal-border flex flex-col items-center py-2 gap-1">
      {tools.map(({ icon: Icon, label }) => (
        <button
          key={label}
          title={label}
          className="w-8 h-8 flex items-center justify-center rounded-md text-terminal-muted hover:text-terminal-text hover:bg-terminal-border/50 transition-colors"
        >
          <Icon className="w-4 h-4" />
        </button>
      ))}
    </div>
  );
}
