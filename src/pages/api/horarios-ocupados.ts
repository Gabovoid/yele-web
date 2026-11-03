import type { APIRoute } from 'astro';
import postgres from 'postgres';

export const prerender = false;

const sql = postgres(import.meta.env.DATABASE_URL, { prepare: false });

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const fecha = url.searchParams.get('fecha');

  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return json({ error: 'Fecha inválida' }, 400);
  }

  try {
    const rows = await sql`
      SELECT hora
      FROM public.solicitudes
      WHERE fecha = ${fecha}
        AND estado NOT IN ('cancelada', 'rechazada')
    `;

    const ocupados = rows.map((r: any) => r.hora);

    return json({
      ok: true,
      fecha,
      ocupados,
    });
  } catch (err: any) {
    console.error('Error al consultar horarios ocupados:', err);
    return json({ error: 'Error en base de datos: ' + err.message }, 500);
  }
};
