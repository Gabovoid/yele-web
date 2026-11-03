import type { APIRoute } from 'astro';
import postgres from 'postgres';

export const prerender = false;

const sql = postgres(import.meta.env.DATABASE_URL, { prepare: false });

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

export const GET: APIRoute = async ({ request, cookies }) => {
  const sessionCookie = cookies.get('yele_session')?.value;
  if (!sessionCookie) return json({ error: 'No autorizado' }, 401);

  let session: any;
  try {
    session = JSON.parse(decodeURIComponent(sessionCookie));
  } catch {
    return json({ error: 'Sesión inválida' }, 401);
  }

  const url = new URL(request.url);
  const solicitudId = url.searchParams.get('solicitud_id');
  if (!solicitudId) {
    return json({ error: 'Falta solicitud_id' }, 400);
  }

  try {
    const parsedId = parseInt(solicitudId, 10);
    if (isNaN(parsedId)) {
      return json({ error: 'ID de solicitud inválido' }, 400);
    }

    // Verificar que el usuario tenga acceso a esta solicitud
    if (session.role === 'cliente') {
      const [solicitud] = await sql`
        SELECT id FROM public.solicitudes
        WHERE id = ${parsedId} AND (cliente_id = ${session.id} OR correo = ${session.email})
        LIMIT 1
      `;
      if (!solicitud) {
        return json({ error: 'Acceso no permitido a esta conversación' }, 403);
      }
    }

    const mensajes = await sql`
      SELECT 
        m.*,
        p.nombres as remitente_nombres,
        p.apellidos as remitente_apellidos,
        p.role as remitente_role_actual
      FROM public.mensajes m
      LEFT JOIN public.profiles p ON p.id = m.remitente_id
      WHERE m.solicitud_id = ${parsedId}
      ORDER BY m.created_at ASC
    `;

    return json({ ok: true, mensajes });
  } catch (err: any) {
    console.error('Error al obtener mensajes:', err);
    return json({ error: 'Error al consultar mensajes: ' + err.message }, 500);
  }
};
