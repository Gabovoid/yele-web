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
  if (!sessionCookie) {
    return json({ error: 'No autenticado.' }, 401);
  }

  let session: any;
  try {
    session = JSON.parse(decodeURIComponent(sessionCookie));
  } catch {
    return json({ error: 'Sesión inválida.' }, 401);
  }

  try {
    // 1. Obtener solicitudes del cliente (por cliente_id o por correo)
    const solicitudes = await sql`
      SELECT 
        s.*,
        tp.nombres as tecnico_nombres,
        tp.apellidos as tecnico_apellidos,
        tp.telefono as tecnico_telefono,
        tp.especialidad as tecnico_especialidad,
        c.id as cotizacion_id,
        c.codigo_cotizacion,
        c.subtotal_materiales,
        c.subtotal_mano_obra,
        c.gastos_operativos,
        c.igv,
        c.total as cotizacion_total,
        c.estado as cotizacion_estado,
        c.dias_validez,
        c.tiempo_estimado_entrega,
        c.condiciones_pago
      FROM public.solicitudes s
      LEFT JOIN public.profiles tp ON tp.id = s.tecnico_id
      LEFT JOIN public.cotizaciones c ON c.solicitud_id = s.id
      WHERE s.cliente_id = ${session.id} OR s.correo = ${session.email}
      ORDER BY s.id DESC
    `;

    // 2. Obtener notificaciones del usuario
    const notificaciones = await sql`
      SELECT * FROM public.notificaciones
      WHERE usuario_id = ${session.id}
      ORDER BY created_at DESC
      LIMIT 20
    `;

    // 3. Obtener mensajes recientes asociados a sus solicitudes
    const solicitudIds = solicitudes.map(s => s.id);
    let mensajes: any[] = [];
    if (solicitudIds.length > 0) {
      mensajes = await sql`
        SELECT m.*, p.nombres, p.apellidos, p.role
        FROM public.mensajes m
        LEFT JOIN public.profiles p ON p.id = m.remitente_id
        WHERE m.solicitud_id IN ${sql(solicitudIds)}
        ORDER BY m.created_at ASC
      `;
    }

    return json({
      ok: true,
      usuario: session,
      solicitudes,
      notificaciones,
      mensajes,
    });
  } catch (err: any) {
    console.error('Error en /api/portal/mis-tramites:', err);
    return json({ error: 'Error al consultar trámites: ' + err.message }, 500);
  }
};
