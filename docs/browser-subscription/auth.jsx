// Browser fixture: actual React AuthProvider/client, loopback test transport only.
import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from '../../frontend/src/context/AuthContext.tsx';

function Probe() {
  const auth = useAuth();
  useEffect(() => { window.qaAuth = auth; }, [auth]);
  return <output id="identity">{auth.isLoading ? 'loading' : auth.user?.username ?? 'anonymous'}</output>;
}
createRoot(document.getElementById('app')).render(<AuthProvider><Probe /></AuthProvider>);
