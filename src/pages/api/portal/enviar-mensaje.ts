import type { APIRoute } from 'astro';
import postgres from 'postgres';
import { z } from 'zod';

export const prerender = false;

const sql = postgres(import.meta.env.DATABASE_URL, { prepare: false });

const msgSchema = z.object({
  solicitud_id: z.number().int().positive(),
  mensaje: z.string().trim().min(1, 'El mensaje no puede estar vacío').max(1500),
});

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

export const POST: APIRoute = async ({ request, cookies }) => {
  const sessionCookie = cookies.get('yele_session')?.value;
  if (!sessionCookie) return json({ error: 'No autorizado' }, 401);

  let session: any;
  try {
    session = JSON.parse(decodeURIComponent(sessionCookie));
  } catch {
    return json({ error: 'Sesión inválida' }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Formato inválido' }, 400);
  }

  const parsed = msgSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'Datos de mensaje inválidos' }, 400);
  }

  const { solicitud_id, mensaje } = parsed.data;

  try {
    // 1. Obtener datos de la solicitud
    const [solicitud] = await sql`
      SELECT id, cliente_id, correo, nombres, apellidos
      FROM public.solicitudes
      WHERE id = ${solicitud_id}
      LIMIT 1
    `;

    if (!solicitud) return json({ error: 'Solicitud no encontrada' }, 404);

    const remitenteRol = session.role === 'admin' ? 'gerencia' : session.role === 'tecnico' ? 'tecnico' : 'cliente';

    // 2. Insertar mensaje
    const [nuevoMsg] = await sql`
      INSERT INTO public.mensajes (
        solicitud_id,
        remitente_id,
        remitente_rol,
        mensaje,
        leido
      ) VALUES (
        ${solicitud_id},
        ${session.id},
        ${remitenteRol},
        ${mensaje},
        false
      )
      RETURNING *
    `;

    // 3. Crear notificación para el receptor
    if (remitenteRol === 'gerencia' || remitenteRol === 'tecnico') {
      // Notificar al cliente si tiene cliente_id o buscarlo por correo
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
            ${'Mensaje de ' + (remitenteRol === 'gerencia' ? 'Gerencia YELE' : 'tu Técnico')},
            ${mensaje.length > 80 ? mensaje.slice(0, 80) + '...' : mensaje},
            'mensaje_nuevo'
          )
        `;
      }
    } else {
      // El cliente escribió -> Notificar a Gerencia (todos los admin)
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
            ${solicitud_id},
            ${'Mensaje de cliente en Trámite #' + solicitud_id},
            ${solicitud.nombres + ': ' + (mensaje.length > 80 ? mensaje.slice(0, 80) + '...' : mensaje)},
            'mensaje_nuevo'
          )
        `;
      }
    }

    return json({
      ok: true,
      mensaje: nuevoMsg,
    }, 201);
  } catch (err: any) {
    console.error('Error al enviar mensaje:', err);
    return json({ error: 'Error al enviar mensaje: ' + err.message }, 500);
  }
};
