import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import App from './App.jsx';
import { AppProvider } from './state/AppState.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ReactFlowProvider>
        <AppProvider>
          <App />
        </AppProvider>
      </ReactFlowProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
