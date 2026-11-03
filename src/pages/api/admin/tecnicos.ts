import type { APIRoute } from 'astro';
import postgres from 'postgres';

export const prerender = false;

const sql = postgres(import.meta.env.DATABASE_URL, { prepare: false });

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

export const GET: APIRoute = async ({ cookies }) => {
  const sessionCookie = cookies.get('yele_session')?.value;
  if (!sessionCookie) return json({ error: 'No autorizado' }, 401);

  try {
    const session = JSON.parse(decodeURIComponent(sessionCookie));
    if (session.role !== 'admin') {
      return json({ error: 'Acceso exclusivo de Gerencia' }, 403);
    }
  } catch {
    return json({ error: 'Sesión inválida' }, 401);
  }

  try {
    const tecnicos = await sql`
      SELECT id, email, nombres, apellidos, telefono, especialidad, activo, created_at
      FROM public.profiles
      WHERE role = 'tecnico'
      ORDER BY nombres ASC, apellidos ASC
    `;

    return json({ ok: true, tecnicos });
  } catch (err: any) {
    console.error('Error al listar técnicos:', err);
    return json({ error: 'Error al consultar técnicos: ' + err.message }, 500);
  }
};
