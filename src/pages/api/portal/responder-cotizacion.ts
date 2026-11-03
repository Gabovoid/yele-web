import type { APIRoute } from 'astro';
import postgres from 'postgres';
import { z } from 'zod';

export const prerender = false;

const sql = postgres(import.meta.env.DATABASE_URL, { prepare: false });

const decisionSchema = z.object({
  cotizacion_id: z.number().int().positive(),
  decision: z.enum(['aceptada', 'rechazada']),
  motivo: z.string().trim().max(500).optional(),
});

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

export const POST: APIRoute = async ({ request, cookies }) => {
  const sessionCookie = cookies.get('yele_session')?.value;
  if (!sessionCookie) return json({ error: 'No autorizado' }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Formato no válido' }, 400);
  }

  const parsed = decisionSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'Datos incompletos' }, 400);
  }

  const { cotizacion_id, decision, motivo } = parsed.data;

  try {
    // 1. Actualizar estado de la cotización
    const [cotizacion] = await sql`
      UPDATE public.cotizaciones
      SET estado = ${decision},
          fecha_respuesta_cliente = NOW(),
          motivo_rechazo = ${motivo || null}
      WHERE id = ${cotizacion_id}
      RETURNING *
    `;

    if (!cotizacion) return json({ error: 'Cotización no encontrada' }, 404);

    // 2. Actualizar estado de la solicitud
    const nuevoEstado = decision === 'aceptada' ? 'aprobada' : 'rechazada';
    await sql`
      UPDATE public.solicitudes
      SET estado = ${nuevoEstado}
      WHERE id = ${cotizacion.solicitud_id}
    `;

    // 3. Notificar a Gerencia
    const admins = await sql`SELECT id FROM public.profiles WHERE role = 'admin'`;
    for (const admin of admins) {
      await sql`
        INSERT INTO public.notificaciones (
          usuario_id,
          solicitud_id,
          titulo,
          mensaje,
          tipo
        ) VALUES (
          ${admin.id},
          ${cotizacion.solicitud_id},
          ${`Cliente ha ${decision.toUpperCase()} la cotización ${cotizacion.codigo_cotizacion}`},
          ${`La solicitud #${cotizacion.solicitud_id} ha sido marcada como ${nuevoEstado}. ${motivo ? 'Nota: ' + motivo : ''}`},
          'estado_cita'
        )
      `;
    }

    return json({
      ok: true,
      message: `Cotización ${decision} exitosamente. Gerencia ha sido notificada para coordinar los siguientes pasos.`,
    });
  } catch (err: any) {
    console.error('Error al responder cotización:', err);
    return json({ error: 'Error al procesar respuesta: ' + err.message }, 500);
  }
};
