// Actual Home/Radar/layout CSS and auth context; only HTTP is fixture-controlled.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import PublicLayout from '../../frontend/src/layouts/PublicLayout.tsx';
import Home from '../../frontend/src/pages/Home.tsx';
import { AuthProvider } from '../../frontend/src/context/AuthContext.tsx';
import { PageReady } from '../../frontend/src/engine/react.tsx';
import '../../frontend/src/styles/index.css';
createRoot(document.getElementById('app')).render(<BrowserRouter><AuthProvider><Routes><Route element={<PublicLayout />}><Route path="*" element={<><Home /><PageReady /></>} /></Route></Routes></AuthProvider></BrowserRouter>);
