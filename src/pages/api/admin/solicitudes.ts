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
    const solicitudes = await sql`
      SELECT 
        s.*,
        tp.nombres as tecnico_nombres,
        tp.apellidos as tecnico_apellidos,
        tp.especialidad as tecnico_especialidad,
        c.id as cotizacion_id,
        c.codigo_cotizacion,
        c.total as cotizacion_total,
        c.estado as cotizacion_estado
      FROM public.solicitudes s
      LEFT JOIN public.profiles tp ON tp.id = s.tecnico_id
      LEFT JOIN public.cotizaciones c ON c.solicitud_id = s.id
      ORDER BY s.id DESC
    `;

    return json({ ok: true, solicitudes });
  } catch (err: any) {
    console.error('Error al obtener solicitudes admin:', err);
    return json({ error: 'Error en base de datos: ' + err.message }, 500);
  }
};

export const POST: APIRoute = async ({ request, cookies }) => {
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

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Formato inválido' }, 400);
  }

  const { solicitud_id, tecnico_id } = body;
  if (!solicitud_id) return json({ error: 'Falta solicitud_id' }, 400);

  try {
    const nuevoEstado = tecnico_id ? 'asignada' : 'pendiente';
    const [solicitud] = await sql`
      UPDATE public.solicitudes
      SET tecnico_id = ${tecnico_id || null},
          estado = ${nuevoEstado},
          assigned_at = ${tecnico_id ? new Date().toISOString() : null}
      WHERE id = ${solicitud_id}
      RETURNING *
    `;

    if (!solicitud) return json({ error: 'Solicitud no encontrada' }, 404);

    // Si se asignó un técnico, notificar al técnico y al cliente
    if (tecnico_id) {
      const [tech] = await sql`SELECT nombres, apellidos, telefono FROM public.profiles WHERE id = ${tecnico_id}`;

      // 1. Notificar al técnico
      await sql`
        INSERT INTO public.notificaciones (
          usuario_id,
          solicitud_id,
          titulo,
          mensaje,
          tipo
        ) VALUES (
          ${tecnico_id},
          ${solicitud_id},
          ${`Nueva Cita Asignada #${solicitud_id}`},
          ${`Gerencia te ha asignado la visita a ${solicitud.nombres} ${solicitud.apellidos} para el ${solicitud.fecha} a las ${solicitud.hora}.`},
          'estado_cita'
        )
      `;

      // 2. Notificar al cliente si tiene cuenta
      let targetUserId = solicitud.cliente_id;
      if (!targetUserId) {
        const [u] = await sql`SELECT id FROM auth.users WHERE email = ${solicitud.correo} LIMIT 1`;
        targetUserId = u?.id;
      }

      if (targetUserId) {
        await sql`
          INSERT INTO public.notificaciones (
            usuario_id,
            solicitud_id,
            titulo,
            mensaje,
            tipo
          ) VALUES (
            ${targetUserId},
            ${solicitud_id},
            ${'Técnico Asignado para tu Cita'},
            ${`El técnico ${tech?.nombres || ''} ${tech?.apellidos || ''} ha sido asignado a tu cita del ${solicitud.fecha} a las ${solicitud.hora}.`},
            'estado_cita'
          )
        `;
      }
    }

    return json({ ok: true, message: 'Técnico asignado con éxito', solicitud });
  } catch (err: any) {
    console.error('Error al asignar técnico:', err);
    return json({ error: 'Error al actualizar técnico: ' + err.message }, 500);
  }
};
