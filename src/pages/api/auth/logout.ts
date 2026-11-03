import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ cookies }) => {
  cookies.delete('yele_session', { path: '/' });
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};

export const GET: APIRoute = async ({ cookies, redirect }) => {
  cookies.delete('yele_session', { path: '/' });
  return redirect('/login');
};
