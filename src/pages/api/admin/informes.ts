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
    const informes = await sql`
      SELECT 
        inf.*,
        s.nombres as cliente_nombres,
        s.apellidos as cliente_apellidos,
        s.telefono as cliente_telefono,
        s.correo as cliente_correo,
        s.motivo as solicitud_motivo,
        s.direccion as solicitud_direccion,
        s.estado as solicitud_estado,
        c.id as cotizacion_id,
        c.codigo_cotizacion,
        c.estado as cotizacion_estado,
        c.motivo_rechazo as cotizacion_motivo_rechazo,
        c.total as cotizacion_total,
        tp.nombres as tecnico_nombres,
        tp.apellidos as tecnico_apellidos
      FROM public.informes_tecnicos inf
      LEFT JOIN public.solicitudes s ON s.id = inf.solicitud_id
      LEFT JOIN public.cotizaciones c ON c.solicitud_id = s.id
      LEFT JOIN public.profiles tp ON tp.id = inf.tecnico_id
      ORDER BY inf.id DESC
    `;

    return json({ ok: true, informes });
  } catch (err: any) {
    console.error('Error al obtener informes admin:', err);
    return json({ error: 'Error en base de datos: ' + err.message }, 500);
  }
};
