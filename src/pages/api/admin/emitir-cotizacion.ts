import type { APIRoute } from 'astro';
import postgres from 'postgres';
import { z } from 'zod';

export const prerender = false;

const sql = postgres(import.meta.env.DATABASE_URL, { prepare: false });

const itemSchema = z.object({
  tipo: z.enum(['material', 'mano_de_obra', 'servicio', 'viatico']).default('servicio'),
  descripcion: z.string().trim().min(1, 'La descripción es requerida'),
  cantidad: z.coerce.number().positive(),
  unidad: z.string().trim().default('und'),
  precio_unitario: z.coerce.number().nonnegative(),
  subtotal: z.coerce.number().nonnegative(),
});

const quoteSchema = z.object({
  solicitud_id: z.coerce.number().int().positive(),
  informe_id: z.coerce.number().int().positive().optional().nullable(),
  items: z.array(itemSchema).min(1, 'Agrega al menos una partida a la cotización'),
  subtotal_materiales: z.coerce.number().nonnegative().default(0),
  subtotal_mano_obra: z.coerce.number().nonnegative().default(0),
  gastos_operativos: z.coerce.number().nonnegative().default(0),
  descuento: z.coerce.number().nonnegative().default(0),
  igv: z.coerce.number().nonnegative().default(0),
  total: z.coerce.number().positive('El total debe ser mayor a 0'),
  dias_validez: z.coerce.number().int().positive().default(15),
  tiempo_estimado_entrega: z.string().trim().default('2 a 3 días hábiles tras aprobación'),
  condiciones_pago: z.string().trim().default('50% adelanto y 50% al finalizar conformidad'),
  observaciones_gerencia: z.string().trim().optional().nullable(),
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
    if (session.role !== 'admin') {
      return json({ error: 'Acceso exclusivo de Gerencia' }, 403);
    }
  } catch {
    return json({ error: 'Sesión inválida' }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Formato inválido' }, 400);
  }

  const parsed = quoteSchema.safeParse(body);
  if (!parsed.success) {
    const firstErr = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0];
    return json({ error: firstErr || 'Datos de cotización inválidos' }, 400);
  }

  const d = parsed.data;

  try {
    // 1. Verificar solicitud
    const [solicitud] = await sql`
      SELECT id, cliente_id, correo, nombres, apellidos 
      FROM public.solicitudes 
      WHERE id = ${d.solicitud_id}
      LIMIT 1
    `;
    if (!solicitud) return json({ error: 'Solicitud no encontrada' }, 404);

    // 2. Generar código de cotización
    const codigo = `COT-${new Date().getFullYear()}-${String(d.solicitud_id).padStart(4, '0')}`;

    // 3. Crear o actualizar cotización en public.cotizaciones
    // Si ya existía una cotización previa para esta solicitud, la actualizamos
    const [existing] = await sql`
      SELECT id FROM public.cotizaciones WHERE solicitud_id = ${d.solicitud_id} LIMIT 1
    `;

    let cotizacionId: number;

    if (existing) {
      cotizacionId = Number(existing.id);
      await sql`
        UPDATE public.cotizaciones
        SET
          informe_id = ${d.informe_id || null},
          gerente_id = ${session.id},
          subtotal_materiales = ${d.subtotal_materiales},
          subtotal_mano_obra = ${d.subtotal_mano_obra},
          gastos_operativos = ${d.gastos_operativos},
          descuento = ${d.descuento},
          igv = ${d.igv},
          total = ${d.total},
          dias_validez = ${d.dias_validez},
          tiempo_estimado_entrega = ${d.tiempo_estimado_entrega},
          condiciones_pago = ${d.condiciones_pago},
          observaciones_gerencia = ${d.observaciones_gerencia || null},
          estado = 'enviada',
          motivo_rechazo = null,
          fecha_respuesta_cliente = null,
          fecha_emision = NOW(),
          updated_at = NOW()
        WHERE id = ${cotizacionId}
      `;

      // Eliminar items previos para reinsertar partidas frescas
      await sql`DELETE FROM public.cotizacion_items WHERE cotizacion_id = ${cotizacionId}`;
    } else {
      const [nueva] = await sql`
        INSERT INTO public.cotizaciones (
          codigo_cotizacion,
          solicitud_id,
          informe_id,
          gerente_id,
          subtotal_materiales,
          subtotal_mano_obra,
          gastos_operativos,
          descuento,
          igv,
          total,
          dias_validez,
          tiempo_estimado_entrega,
          condiciones_pago,
          observaciones_gerencia,
          estado,
          fecha_emision
        ) VALUES (
          ${codigo},
          ${d.solicitud_id},
          ${d.informe_id || null},
          ${session.id},
          ${d.subtotal_materiales},
          ${d.subtotal_mano_obra},
          ${d.gastos_operativos},
          ${d.descuento},
          ${d.igv},
          ${d.total},
          ${d.dias_validez},
          ${d.tiempo_estimado_entrega},
          ${d.condiciones_pago},
          ${d.observaciones_gerencia || null},
          'enviada',
          NOW()
        )
        RETURNING id
      `;
      cotizacionId = Number(nueva.id);
    }

    // 4. Insertar las partidas / items
    for (const it of d.items) {
      await sql`
        INSERT INTO public.cotizacion_items (
          cotizacion_id,
          tipo,
          descripcion,
          cantidad,
          unidad,
          precio_unitario,
          subtotal
        ) VALUES (
          ${cotizacionId},
          ${it.tipo},
          ${it.descripcion},
          ${it.cantidad},
          ${it.unidad},
          ${it.precio_unitario},
          ${it.subtotal}
        )
      `;
    }

    // 5. Actualizar estado de la solicitud a 'cotizada'
    await sql`
      UPDATE public.solicitudes
      SET estado = 'cotizada'
      WHERE id = ${d.solicitud_id}
    `;

    // 6. Notificar al cliente
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
          ${d.solicitud_id},
          ${`¡Presupuesto Formal Listo! (${codigo})`},
          ${`Gerencia ha emitido la cotización para tu solicitud #${d.solicitud_id} por un total de S/. ${d.total.toFixed(2)}. Ingresa a tu portal para revisar el desglose y confirmar el servicio.`},
          'cotizacion_emitida'
        )
      `;
    }

    return json({
      ok: true,
      cotizacion_id: cotizacionId,
      codigo_cotizacion: codigo,
      message: `Cotización ${codigo} emitida con éxito al cliente.`,
    });
  } catch (err: any) {
    console.error('Error al emitir cotización:', err);
    return json({ error: 'Error al registrar cotización: ' + err.message }, 500);
  }
};
