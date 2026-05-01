import React, { useState } from 'react';
import ConnectForm from './components/ConnectForm';
import TerminalPage from './components/TerminalPage';
import type { ConnectConfig } from './types';

type Page = 'connect' | 'terminal';

export default function App() {
  const [page, setPage] = useState<Page>('connect');
  const [config, setConfig] = useState<ConnectConfig | null>(null);

  function handleConnect(cfg: ConnectConfig) {
    setConfig(cfg);
    setPage('terminal');
  }

  function handleDisconnect() {
    setConfig(null);
    setPage('connect');
  }

  if (page === 'terminal' && config) {
    return <TerminalPage config={config} onDisconnect={handleDisconnect} />;
  }

  return <ConnectForm onConnect={handleConnect} />;
}
