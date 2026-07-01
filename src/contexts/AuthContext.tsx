import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface Profile {
  id: string;
  store_id: string;
  auth_user_id: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  show_onboarding_guide: boolean;
}

interface StoreModule {
  is_active: boolean;
  activated_at: string | null;
  deactivation_scheduled_at: string | null;
  deactivation_requested_at: string | null;
}

type StoreModules = {
  [moduleKey: string]: StoreModule;
} | null;

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  bootstrapping: boolean;
  needsOnboarding: boolean;
  dismissOnboarding: () => void;
  showGuide: boolean;
  setShowGuide: (v: boolean) => void;
  toggleGuidePreference: (enabled: boolean) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName: string) => Promise<void>;
  signOut: () => Promise<void>;
  storeModules: StoreModules;
  modulesLoading: boolean;
  revalidateModules: () => Promise<void>;
  capabilities: Record<string, boolean>;
  capabilitiesLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const ONBOARDING_KEY = 'onboarding_dismissed';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [storeModules, setStoreModules] = useState<StoreModules>(null);
  // Starts true: RequireConnectModule treats modulesLoading=false as "checked, no access" —
  // must stay true until the first load attempt resolves, or a cold boot / hard refresh
  // on a /connect/* route redirects away before get_store_modules ever runs.
  const [modulesLoading, setModulesLoading] = useState(true);
  const [moduleFailureCount, setModuleFailureCount] = useState(0);
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>({});
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(false);

  const fetchProfile = async (userId: string): Promise<Profile | null> => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('auth_user_id', userId)
      .maybeSingle();
    const p = data as Profile | null;
    setProfile(p);
    return p;
  };

  const loadStoreModules = async (storeId: string) => {
    setModulesLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_store_modules', {
        p_store_id: storeId,
      });

      if (error) {
        console.error('[Modules] RPC error:', error);
        setModuleFailureCount((prev) => prev + 1);
        // After 3 failures, fail-secure by setting modules to null (deny all)
        if (moduleFailureCount >= 2) {
          console.warn('[Modules] Too many failures - failing secure (deny all)');
          setStoreModules(null);
        }
        return;
      }

      // Reset failure count on success
      setModuleFailureCount(0);

      // Convert array to object keyed by module_key
      const modules: StoreModules = {};
      if (Array.isArray(data)) {
        data.forEach((m: any) => {
          modules[m.module_key] = {
            is_active: m.is_active,
            activated_at: m.activated_at,
            deactivation_scheduled_at: m.deactivation_scheduled_at,
            deactivation_requested_at: m.deactivation_requested_at,
          };
        });
      }
      setStoreModules(modules);
    } catch (err) {
      console.error('[Modules] Unexpected error:', err);
      setModuleFailureCount((prev) => prev + 1);
      if (moduleFailureCount >= 2) {
        setStoreModules(null);
      }
    } finally {
      setModulesLoading(false);
    }
  };

  const loadCapabilities = async (storeId: string) => {
    setCapabilitiesLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_my_capabilities', { p_store_id: storeId });
      if (error) {
        console.error('[Capabilities] RPC error:', error);
        return;
      }
      setCapabilities((data as Record<string, boolean>) || {});
    } catch (err) {
      console.error('[Capabilities] Unexpected error:', err);
    } finally {
      setCapabilitiesLoading(false);
    }
  };

  const revalidateModules = async () => {
    if (profile?.store_id) {
      await loadStoreModules(profile.store_id);
    }
  };

  const runBootstrap = async (userId: string, fullName?: string | null) => {
    setBootstrapping(true);
    try {
      const { error } = await supabase.rpc('bootstrap_new_store', {
        p_auth_user_id: userId,
        p_store_name: 'Minha Loja',
        p_full_name: fullName || null,
      });
      if (error) {
        console.error('[Bootstrap] Error:', error);
        return;
      }
      const p = await fetchProfile(userId);
      const dismissed = localStorage.getItem(ONBOARDING_KEY);
      if (!dismissed) {
        setNeedsOnboarding(true);
      }
      // New users always see the guide
      if (p?.show_onboarding_guide) {
        // Guia interativo desabilitado — não exibir automaticamente
      }
    } catch (err) {
      console.error('[Bootstrap] Unexpected error:', err);
    } finally {
      setBootstrapping(false);
    }
  };

  const handleUser = async (sessionUser: User) => {
    const p = await fetchProfile(sessionUser.id);
    if (!p) {
      const fullName = sessionUser.user_metadata?.full_name || null;
      await runBootstrap(sessionUser.id, fullName);
    } else {
      if (p.is_active === false) {
        await supabase.auth.signOut();
        setProfile(null);
        alert('Seu acesso foi bloqueado. Contate o proprietário da loja.');
        return;
      }
      // Load store modules and capabilities for this user
      if (p.store_id) {
        await Promise.all([
          loadStoreModules(p.store_id),
          loadCapabilities(p.store_id),
        ]);
      }
      const dismissed = localStorage.getItem(ONBOARDING_KEY);
      if (!dismissed) {
        // Check onboarding
      }
      // Show guide if enabled in profile
      if (p.show_onboarding_guide) {
        // Guia interativo desabilitado — não exibir automaticamente
      }
    }
  };

  // Auth state listener
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          setTimeout(() => handleUser(session.user), 0);
        } else {
          setProfile(null);
          setStoreModules(null);
          setModulesLoading(false);
          setCapabilities({});
          setNeedsOnboarding(false);
          setShowGuide(false);
        }
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        handleUser(session.user);
      } else {
        setModulesLoading(false);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Revalidate modules on tab visibility change
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && profile?.store_id && !modulesLoading) {
        revalidateModules();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [profile?.store_id, modulesLoading]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName }, emailRedirectTo: window.location.origin },
    });
    if (error) throw error;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const dismissOnboarding = () => {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    setNeedsOnboarding(false);
  };

  const toggleGuidePreference = async (enabled: boolean) => {
    if (!profile) return;
    await supabase.from('profiles').update({ show_onboarding_guide: enabled } as any).eq('id', profile.id);
    setProfile(prev => prev ? { ...prev, show_onboarding_guide: enabled } : prev);
    if (!enabled) setShowGuide(false);
  };

  return (
    <AuthContext.Provider value={{
      session, user, profile, loading, bootstrapping,
      needsOnboarding, dismissOnboarding,
      showGuide, setShowGuide, toggleGuidePreference,
      signIn, signUp, signOut,
      storeModules, modulesLoading, revalidateModules,
      capabilities, capabilitiesLoading,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
