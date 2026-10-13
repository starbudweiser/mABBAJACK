import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { I18nProvider } from './locales';
import { COMMON_UI, storedLanguage } from './locales/uiScreens';
import './index.css';
import { installGlobalLogCapture, sendClientLog } from './services/clientLog';

installGlobalLogCapture();

// ErrorBoundary to catch silent React crashes and display them
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[mABBAJACK] React Error:', error, info.componentStack);
    sendClientLog('error', `Plantage React : ${error.message}`, `${error.stack || ''}\n${info.componentStack || ''}`, 'js');
  }
  render() {
    if (this.state.error) {
      const ui = COMMON_UI[storedLanguage()];
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#181818', color: '#f87171', fontFamily: 'monospace', padding: 32,
        }}>
          <div style={{ maxWidth: 640 }}>
            <h1 style={{ color: '#ef4444', fontSize: 20, marginBottom: 12 }}>{ui.reactError}</h1>
            <pre style={{
              background: '#181818', border: '1px solid #ef444440', borderRadius: 8,
              padding: 16, fontSize: 12, whiteSpace: 'pre-wrap', overflowY: 'auto', maxHeight: 400,
              color: '#fecaca',
            }}>
              {this.state.error.message}
              {'\n\n'}
              {this.state.error.stack}
            </pre>
            <button
              onClick={() => this.setState({ error: null })}
              style={{
                marginTop: 16, padding: '8px 20px', borderRadius: 8, border: 'none',
                background: '#ef4444', color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: 13,
              }}
            >
              {ui.reload}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <I18nProvider>
          <App />
        </I18nProvider>
      </ErrorBoundary>
    </React.StrictMode>
  );
}
