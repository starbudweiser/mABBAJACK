import React from 'react';
import App from './App';
import SimpleApp from './simple/SimpleApp';
import { useUiMode } from './state/uiMode';

/** Choisit la présentation : Simple (parcours guidé) ou Expert (onglets). */
export const Root: React.FC = () => (useUiMode().mode === 'simple' ? <SimpleApp /> : <App />);

export default Root;
