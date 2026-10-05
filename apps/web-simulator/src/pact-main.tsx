import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import PactDemo from './PactDemo';

createRoot(document.getElementById('root')!).render(<StrictMode><PactDemo bundled /></StrictMode>);
