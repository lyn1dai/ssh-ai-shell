import React from 'react';
import { Clipboard, Folder, User, Settings, Server } from 'lucide-react';

export type SidebarPanel = 'clipboard' | 'files' | 'userinfo' | 'settings' | 'hosts' | null;

interface Props {
  activePanel: SidebarPanel;
  onPanelToggle: (panel: SidebarPanel) => void;
}

const TOOLS: { icon: React.ElementType; label: string; panel: SidebarPanel }[] = [
  { icon: Clipboard, label: '命令历史', panel: 'clipboard' },
  { icon: Folder,    label: '文件管理', panel: 'files' },
  { icon: Server,    label: '主机管理', panel: 'hosts' },
  { icon: User,      label: '会话信息', panel: 'userinfo' },
  { icon: Settings,  label: '设置',    panel: 'settings' },
];

export default function Sidebar({ activePanel, onPanelToggle }: Props) {
  return (
    <div className="w-10 flex-shrink-0 bg-terminal-surface border-r border-terminal-border flex flex-col items-center py-2 gap-1 relative z-50">
      {TOOLS.map(({ icon: Icon, label, panel }) => (
        <button
          key={label}
          title={label}
          onClick={() => onPanelToggle(activePanel === panel ? null : panel)}
          className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors
            ${activePanel === panel
              ? 'bg-terminal-blue/20 text-terminal-blue'
              : 'text-terminal-muted hover:text-terminal-text hover:bg-terminal-border/50'
            }`}
        >
          <Icon className="w-4 h-4" />
        </button>
      ))}
    </div>
  );
}
