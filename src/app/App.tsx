import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/core';
import { AuthGate } from './auth/AuthGate';
import { AppShell } from './layout/AppShell';
import { modules } from './modules';
import { HomeScreen } from './screens/HomeScreen';
import { MoreScreen } from './screens/MoreScreen';
import { SystemScreen } from './screens/SystemScreen';
import { TeamScreen } from './screens/TeamScreen';

export function App() {
  return (
    <AuthProvider>
      <AuthGate>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<HomeScreen />} />
            {modules.map((m) => (
              <Route key={m.id} path={m.path} element={<m.Screen />} />
            ))}
            <Route path="/more" element={<MoreScreen />} />
            <Route path="/team" element={<TeamScreen />} />
            <Route path="/system" element={<SystemScreen />} />
            <Route path="*" element={<HomeScreen />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </AuthGate>
    </AuthProvider>
  );
}
