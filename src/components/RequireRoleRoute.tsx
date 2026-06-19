import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { canAccessRoute } from '@/lib/roleAccess';

export default function RequireRoleRoute({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const location = useLocation();
  if (!profile) return <>{children}</>;
  if (!canAccessRoute(profile.role, location.pathname)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
