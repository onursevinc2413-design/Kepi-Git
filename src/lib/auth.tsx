import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { PlanId } from './playBilling';
import { Capacitor } from '@capacitor/core';

export interface Profile {
  id: string;
  email: string | null;
  plan: PlanId;
  trial_started_at: string | null;
  expires_at: string | null;
}

interface AuthCtx {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  accessStatus: 'trial' | 'active' | 'expired' | 'loading';
  trialDaysLeft: number;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({} as AuthCtx);
export const useAuth = () => useContext(Ctx);

const DAY = 24 * 60 * 60 * 1000;
const TRIAL_DAYS = 20;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = async (uid: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, plan, trial_started_at, expires_at')
      .eq('id', uid)
      .maybeSingle();
    if (error) return;
    if (!data) {
      const { data: created } = await supabase
        .from('profiles')
        .insert({ id: uid, email: session?.user?.email ?? null })
        .select('id, email, plan, trial_started_at, expires_at')
        .maybeSingle();
      if (created) setProfile(created as Profile);
      return;
    }
    setProfile(data as Profile);
  };

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (data.session?.user) loadProfile(data.session.user.id).finally(() => setLoading(false));
      else setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      (async () => {
        setSession(sess);
        if (sess?.user) {
          await loadProfile(sess.user.id);
        } else {
          setProfile(null);
        }
      })();
    });

    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  const refreshProfile = async () => {
    if (session?.user) await loadProfile(session.user.id);
  };

  const signInWithGoogle: AuthCtx['signInWithGoogle'] = async () => {
    const isMobile = Capacitor.isNativePlatform();

    const redirectTo = isMobile
      ? 'com.kepi.app://'
      : window.location.origin.startsWith('http://localhost')
        ? `${window.location.origin}/`
        : window.location.origin;

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        skipBrowserRedirect: false,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    });

    if (error) return { error: error.message };
    if (!data?.url) return { error: 'OAuth URL alınamadı' };

    // skipBrowserRedirect: false -> Supabase SDK window.location.href atar,
    // Capacitor bunu sistem tarayıcısında açar. Browser.open()'a gerek yok.
    if (!isMobile) {
      window.location.href = data.url;
    }
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setSession(null);
  };

  const now = Date.now();
  const trialStart = profile?.trial_started_at ? new Date(profile.trial_started_at).getTime() : now;
  const trialDaysLeft = Math.max(0, TRIAL_DAYS - Math.floor((now - trialStart) / DAY));

  let accessStatus: AuthCtx['accessStatus'] = 'loading';
  if (profile) {
    if (profile.plan === 'monthly' || profile.plan === 'yearly') {
      const exp = profile.expires_at ? new Date(profile.expires_at).getTime() : 0;
      accessStatus = exp > now ? 'active' : 'expired';
    } else if (profile.plan === 'trial') {
      accessStatus = trialDaysLeft > 0 ? 'trial' : 'expired';
    } else {
      accessStatus = 'expired';
    }
  }

  return (
    <Ctx.Provider value={{
      user: session?.user ?? null,
      session, profile, loading, accessStatus, trialDaysLeft,
      signInWithGoogle, signOut, refreshProfile,
    }}>
      {children}
    </Ctx.Provider>
  );
}
