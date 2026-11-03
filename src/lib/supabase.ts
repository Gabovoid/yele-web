import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || 'https://vzgeqhfwbnpolnlhxczs.supabase.co';
const rawAnonKey = (import.meta.env.PUBLIC_SUPABASE_ANON_KEY || '').trim();

// Evita que @supabase/supabase-js lance una excepción fatal si falta la clave en .env
export const isSupabaseConfigured = Boolean(
  rawAnonKey && 
  rawAnonKey !== 'TU_SUPABASE_ANON_KEY_AQUI' &&
  rawAnonKey.length > 20
);

const safeAnonKey = isSupabaseConfigured 
  ? rawAnonKey 
  : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy_fallback_key';

export const supabase = createClient(supabaseUrl, safeAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export type UserRole = 'cliente' | 'tecnico' | 'admin';

export interface UserProfile {
  id: string;
  email: string;
  role: UserRole;
  nombres?: string;
  apellidos?: string;
  telefono?: string;
  especialidad?: string;
  activo: boolean;
}

/**
 * Obtiene el usuario activo desde la cookie de sesión o desde Supabase
 */
export async function getActiveSessionUser(): Promise<UserProfile | null> {
  // 1. Probar sesión de cookie
  try {
    const match = document.cookie.match(new RegExp('(^| )yele_session=([^;]+)'));
    if (match && match[2]) {
      const parsed = JSON.parse(decodeURIComponent(match[2]));
      if (parsed?.id) return parsed as UserProfile;
    }
  } catch (e) {
    // ignorar error de parseo
  }

  // 2. Probar sesión de Supabase Auth si está configurado
  if (isSupabaseConfigured) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();
        if (profile) return profile as UserProfile;
      }
    } catch (e) {
      // fallo silencioso
    }
  }

  return null;
}

export const getCurrentProfile = getActiveSessionUser;

/**
 * Inicia sesión para clientes con Google OAuth
 */
export async function loginWithGoogle() {
  if (!isSupabaseConfigured) {
    throw new Error(
      'Para usar Google OAuth, copia tu PUBLIC_SUPABASE_ANON_KEY en el archivo .env desde el panel de Supabase.'
    );
  }

  const redirectTo = `${window.location.origin}/auth/callback`;
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  });
  if (error) throw error;
  return data;
}

/**
 * Registro de nuevo cliente mediante API segura
 */
export async function registerCliente(data: {
  email: string;
  password: string;
  nombres: string;
  apellidos: string;
  telefono: string;
}) {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...data,
      role: 'cliente',
    }),
  });

  const result = await res.json();
  if (!res.ok) {
    throw new Error(result.error || 'No se pudo completar el registro.');
  }

  return result;
}

/**
 * Inicio de sesión para Clientes (vía API o Supabase)
 */
export async function loginCliente(email: string, pass: string) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: pass,
      tipo: 'cliente',
    }),
  });

  const result = await res.json();
  if (!res.ok) {
    throw new Error(result.error || 'Credenciales incorrectas.');
  }

  return result;
}

/**
 * Inicio de sesión exclusivo para Personal de la Empresa (Técnicos y Gerencia)
 */
export async function loginTrabajador(email: string, pass: string) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: pass,
      tipo: 'trabajador',
    }),
  });

  const result = await res.json();
  if (!res.ok) {
    throw new Error(result.error || 'Error al autenticar credenciales.');
  }

  return result;
}

/**
 * Cierre de sesión general
 */
export async function logoutUser() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
    if (isSupabaseConfigured) {
      await supabase.auth.signOut();
    }
  } finally {
    window.location.href = '/login';
  }
}
