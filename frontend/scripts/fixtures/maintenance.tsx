import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MaintenanceBanner } from '../../src/features/maintenance/MaintenanceBanner'

createRoot(document.getElementById('root')!).render(
  <BrowserRouter><MaintenanceBanner /></BrowserRouter>,
)
