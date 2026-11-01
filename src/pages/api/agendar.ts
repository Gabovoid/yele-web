import type { APIRoute } from 'astro';
import postgres from 'postgres';
import nodemailer from 'nodemailer';
import { solicitudSchema } from '../../validaciones/Validacion';
export const prerender = false; 

const sql = postgres(import.meta.env.DATABASE_URL, { prepare: false });

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
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
  
    headers: { 'Content-Type': 'application/json' },
  });

export const POST: APIRoute = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    
    body = await request.json();
  } catch {
    return json({ error: 'Solicitud inválida' }, 400);
  }
  if (typeof body.website === 'string' && body.website.length > 0) {
    return json({ ok: true });
  }

  const parsed = solicitudSchema.safeParse(body);
  if (!parsed.success) {
    return json({ errores: parsed.error.flatten().fieldErrors }, 400);
  }
  const d = parsed.data;

  let id: number;
  try {
    const [row] = await sql`
      INSERT INTO solicitudes
        (nombres, apellidos, correo, telefono, direccion, tipo, motivo, detalles, fecha, hora)
      VALUES
        (${d.nombres}, ${d.apellidos}, ${d.correo}, ${d.telefono}, ${d.direccion},
         ${d.tipo}, ${d.motivo}, ${d.detalles}, ${d.fecha}, ${d.hora})
      RETURNING id`;
    id = row.id;
  } catch (e: any) {
    if (e?.code === '23505') {
      return json({ error: 'Ese horario ya fue reservado. Elige otro.' }, 409);
    }
    console.error('Error BD:', e);
    return json({ error: 'No pudimos guardar tu solicitud.' }, 500);
  }

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
    await sql`UPDATE solicitudes SET correo_enviado = TRUE WHERE id = ${id}`;
  } catch (e) {
    console.error('Falló el correo de la solicitud', id, e);
  }

  return json({ ok: true });
};