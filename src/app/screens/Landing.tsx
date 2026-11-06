import { Navigate } from 'react-router-dom';
import { useSession } from '@/core';
import { HomeScreen } from './HomeScreen';

/** Where the app opens: the dashboard for the owner and admins; everyone else gets the home page of their sections. */
export function Landing() {
  const { role } = useSession();
  return role === 'owner' || role === 'admin' ? <Navigate to="/dashboard" replace /> : <HomeScreen />;
}
