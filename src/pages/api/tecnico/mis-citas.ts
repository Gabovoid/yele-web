import type { APIRoute } from 'astro';
import postgres from 'postgres';

export const prerender = false;

const sql = postgres(import.meta.env.DATABASE_URL, { prepare: false });

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

function getSession(cookies: any) {
  const sessionCookie = cookies.get('yele_session')?.value;
  if (!sessionCookie) return null;
  try {
    const s = JSON.parse(decodeURIComponent(sessionCookie));
    return s.role === 'tecnico' || s.role === 'admin' ? s : null;
  } catch {
    return null;
  }
}

export const GET: APIRoute = async ({ cookies }) => {
  const session = getSession(cookies);
  if (!session) return json({ error: 'Acceso no autorizado' }, 401);

  try {
    const citas = await sql`
      SELECT s.*
      FROM public.solicitudes s
      WHERE s.tecnico_id = ${session.id}
      ORDER BY s.fecha ASC, s.hora ASC
    `;

    return json({ ok: true, citas });
  } catch (err: any) {
    console.error('Error al obtener citas técnico:', err);
    return json({ error: 'Error en base de datos: ' + err.message }, 500);
  }
};

export const PATCH: APIRoute = async ({ request, cookies }) => {
  const session = getSession(cookies);
  if (!session) return json({ error: 'Acceso no autorizado' }, 401);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Formato inválido' }, 400);
  }

  const { solicitud_id, estado } = body;
  if (!solicitud_id || !estado) {
    return json({ error: 'Faltan parámetros requeridos' }, 400);
  }

  try {
    const [cita] = await sql`
      UPDATE public.solicitudes
      SET estado = ${estado}
      WHERE id = ${solicitud_id} AND (tecnico_id = ${session.id} OR ${session.role} = 'admin')
      RETURNING *
    `;

    if (!cita) {
      return json({ error: 'No se encontró la cita asignada' }, 404);
    }

    return json({ ok: true, cita });
  } catch (err: any) {
    console.error('Error al actualizar estado:', err);
    return json({ error: 'Error al actualizar estado: ' + err.message }, 500);
  }
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = getSession(cookies);
  if (!session) return json({ error: 'Acceso no autorizado' }, 401);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Formato inválido' }, 400);
  }

  const {
    solicitud_id,
    diagnostico,
    trabajo_realizado,
    trabajo_sugerido,
    recomendaciones,
    observaciones,
    nivel_prioridad = 'media',
    materiales_sugeridos,
    materiales_requeridos,
    horas_hombre_estimadas,
    horas_estimadas,
    evidencias = [],
  } = body;

  const trabajoFinal = trabajo_sugerido || trabajo_realizado;
  const horasFinal = Number(horas_estimadas || horas_hombre_estimadas || 1);
  const materialesFinal = materiales_requeridos || materiales_sugeridos || [];
  const obsFinal = observaciones || recomendaciones || null;

  if (!solicitud_id || !diagnostico || !trabajoFinal) {
    return json({ error: 'El diagnóstico y el trabajo son obligatorios.' }, 400);
  }

  try {
    // 1. Insertar el informe técnico
    const [informe] = await sql`
      INSERT INTO public.informes_tecnicos (
        solicitud_id,
        tecnico_id,
        diagnostico,
        trabajo_sugerido,
        observaciones,
        nivel_prioridad,
        materiales_requeridos,
        horas_estimadas,
        fotos_evidencia
      ) VALUES (
        ${solicitud_id},
        ${session.id},
        ${diagnostico},
        ${trabajoFinal},
        ${obsFinal},
        ${nivel_prioridad},
        ${JSON.stringify(materialesFinal)},
        ${horasFinal},
        ${evidencias}
      )
      RETURNING *
    `;

    // 2. Actualizar estado de la solicitud
    await sql`
      UPDATE public.solicitudes
      SET estado = 'informe_enviado',
          attended_at = NOW()
      WHERE id = ${solicitud_id}
    `;

    // 3. Notificar a todos los administradores (Gerencia)
    const admins = await sql`SELECT id FROM public.profiles WHERE role = 'admin'`;
    for (const a of admins) {
      await sql`
        INSERT INTO public.notificaciones (
          usuario_id,
          solicitud_id,
          titulo,
          mensaje,
          tipo
        ) VALUES (
          ${a.id},
          ${solicitud_id},
          ${`Nuevo Informe Técnico - Cita #${solicitud_id}`},
          ${`El técnico ${session.nombres || ''} ${session.apellidos || ''} ha enviado el informe técnico para la solicitud #${solicitud_id}. Ya puedes proceder con la cotización formal.`},
          'informe_recibido'
        )
      `;
    }

    return json({ ok: true, informe });
  } catch (err: any) {
    console.error('Error al guardar informe técnico:', err);
    return json({ error: 'Error al registrar informe: ' + err.message }, 500);
  }
};
