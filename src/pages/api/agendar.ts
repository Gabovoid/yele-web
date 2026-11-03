import type { APIRoute } from 'astro';
import postgres from 'postgres';
import nodemailer from 'nodemailer';
import { solicitudSchema } from '../../validaciones/Validacion';

export const prerender = false;

const sql = postgres(import.meta.env.DATABASE_URL, { prepare: false });

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: import.meta.env.GMAIL_USER,
    pass: import.meta.env.GMAIL_APP_PASSWORD,
  },
});

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

export const POST: APIRoute = async ({ request, cookies }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Solicitud inválida' }, 400);
  }

  // Honeypot antispam
  if (typeof body.website === 'string' && body.website.length > 0) {
    return json({ ok: true });
  }

  const parsed = solicitudSchema.safeParse(body);
  if (!parsed.success) {
    const errorMap = parsed.error.flatten().fieldErrors;
    const firstMsg = Object.values(errorMap)[0]?.[0];
    return json({ error: firstMsg || 'Datos incompletos o inválidos.', errores: errorMap }, 400);
  }

  const d = parsed.data;

  // 1. Identificar cliente_id si el usuario está autenticado o existe en la base de datos
  let clienteId: string | null = null;
  const sessionCookie = cookies.get('yele_session')?.value;
  if (sessionCookie) {
    try {
      const sess = JSON.parse(decodeURIComponent(sessionCookie));
      clienteId = sess.id || null;
    } catch {
      clienteId = null;
    }
  }

  if (!clienteId) {
    const [existingProfile] = await sql`
      SELECT id FROM public.profiles WHERE email = ${d.correo} LIMIT 1
    `;
    if (existingProfile) {
      clienteId = existingProfile.id;
    }
  }

  // 2. Validar que el horario no esté ya ocupado
  try {
    const [ocupado] = await sql`
      SELECT id FROM public.solicitudes
      WHERE fecha = ${d.fecha}
        AND hora = ${d.hora}
        AND estado NOT IN ('cancelada', 'rechazada')
      LIMIT 1
    `;

    if (ocupado) {
      return json({
        error: `El horario de las ${d.hora} para el día ${d.fecha} ya fue reservado. Por favor elige otro horario disponible.`,
      }, 409);
    }
  } catch (err: any) {
    console.error('Error al verificar horario:', err);
  }

  // 3. Insertar la solicitud vinculándola al cliente_id
  let id: number;
  try {
    const [row] = await sql`
      INSERT INTO public.solicitudes
        (cliente_id, nombres, apellidos, correo, telefono, direccion, tipo, motivo, detalles, fecha, hora, estado)
      VALUES
        (${clienteId}, ${d.nombres}, ${d.apellidos}, ${d.correo}, ${d.telefono}, ${d.direccion},
         ${d.tipo}, ${d.motivo}, ${d.detalles}, ${d.fecha}, ${d.hora}, 'pendiente')
      RETURNING id`;
    id = Number(row.id);
  } catch (e: any) {
    if (e?.code === '23505') {
      return json({ error: 'Ese horario ya fue reservado. Elige otro.' }, 409);
    }
    console.error('Error BD al guardar solicitud:', e);
    return json({ error: 'No pudimos guardar tu solicitud. Intente nuevamente.' }, 500);
  }

  // 4. Crear notificación automática para Gerencia
  try {
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
          ${id},
          ${`Nueva Cita Solicitada #${id}`},
          ${`${d.nombres} ${d.apellidos} solicita visita para el ${d.fecha} a las ${d.hora}. Motivo: ${d.motivo}`},
          'estado_cita'
        )
      `;
    }

    if (clienteId) {
      await sql`
        INSERT INTO public.notificaciones (
          usuario_id,
          solicitud_id,
          titulo,
          mensaje,
          tipo
        ) VALUES (
          ${clienteId},
          ${id},
          ${`Solicitud Registrada (#${id})`},
          ${`Tu cita para el ${d.fecha} a las ${d.hora} ha sido agendada con éxito. Gerencia asignará a un técnico especialista en breve.`},
          'estado_cita'
        )
      `;
    }
  } catch (notifErr) {
    console.error('Error al generar notificación para admin:', notifErr);
  }

  // 5. Enviar correo informativo
  try {
    await transporter.sendMail({
      from: `"Web Yele" <${import.meta.env.GMAIL_USER}>`,
      to: import.meta.env.GMAIL_DESTINO,
      replyTo: d.correo,
      subject: `Nueva visita: ${d.nombres} ${d.apellidos} — ${d.fecha} ${d.hora}`,
      html: `
        <h2>Nueva solicitud #${id}</h2>
        <p><b>Fecha:</b> ${esc(d.fecha)} a las ${esc(d.hora)}</p>
        <p><b>Tipo:</b> ${esc(d.tipo)}<br><b>Motivo:</b> ${esc(d.motivo)}</p>
        <p><b>Cliente:</b> ${esc(d.nombres)} ${esc(d.apellidos)}<br>
           <b>Correo:</b> ${esc(d.correo)}<br>
           <b>Teléfono:</b> ${esc(d.telefono)}<br>
           <b>Dirección:</b> ${esc(d.direccion)}</p>
        <p><b>Detalles:</b><br>${esc(d.detalles).replace(/\n/g, '<br>')}</p>`,
    });
    await sql`UPDATE public.solicitudes SET correo_enviado = TRUE WHERE id = ${id}`;
  } catch (e) {
    console.error('Falló el envío de correo de la solicitud', id, e);
  }

  return json({ 
    ok: true, 
    id, 
    message: '¡Cita registrada con éxito! Ya puedes verla en tu portal de trámites.' 
  });
};
