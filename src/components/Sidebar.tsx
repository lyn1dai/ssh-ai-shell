import React from 'react';
import { Menu, Clipboard, Folder, Activity, User, Settings } from 'lucide-react';

interface Props {
  onSettings?: () => void;
}

export default function Sidebar({ onSettings }: Props) {
  const tools = [
    { icon: Menu, label: '菜单', onClick: undefined },
    { icon: Clipboard, label: '剪贴板', onClick: undefined },
    { icon: Folder, label: '文件管理', onClick: undefined },
    { icon: Activity, label: '系统监控', onClick: undefined },
    { icon: User, label: '用户', onClick: undefined },
    { icon: Settings, label: '设置', onClick: onSettings },
  ];

  return (
    <div className="w-10 flex-shrink-0 bg-terminal-surface border-r border-terminal-border flex flex-col items-center py-2 gap-1">
      {tools.map(({ icon: Icon, label, onClick }) => (
        <button
          key={label}
          title={label}
          onClick={onClick}
          className="w-8 h-8 flex items-center justify-center rounded-md text-terminal-muted hover:text-terminal-text hover:bg-terminal-border/50 transition-colors"
        >
          <Icon className="w-4 h-4" />
        </button>
      ))}
    </div>
  );
}
