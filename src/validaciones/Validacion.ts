import { z } from 'zod';

export const SLOTS = ['08:00', '12:00', '16:00'] as const;
export const TIPOS = [
  'Visita técnica presencial',
  'Cotización en sitio',
  'Asesoría virtual',
] as const;
export const MOTIVOS = [
  'Instalación eléctrica',
  'Mantenimiento preventivo o correctivo',
  'Tableros eléctricos',
  'Iluminación LED',
  'Proyecto eléctrico',
  'Solución industrial',
  'Otro',
] as const;
export const MAX_DAYS_AHEAD = 60;

export const HORARIOS_POR_DIA: Record<number, readonly string[]> = {
  1: SLOTS,
  2: SLOTS,
  3: SLOTS,
  4: SLOTS,
  5: SLOTS,
  6: ['08:00', '12:00'],
};
const DIAS_CERRADOS = [0]; // domingo

const hoyLima = () =>
  new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);

const sumarDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const solicitudSchema = z
  .object({
    nombres: z.string().trim().min(2, 'Nombres muy cortos').max(80),
    apellidos: z.string().trim().min(2, 'Apellidos muy cortos').max(80),
    correo: z
      .string()
      .trim()
      .toLowerCase()
      .max(150)
      .regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'Correo inválido'),
    telefono: z
      .string()
      .trim()
      .regex(/^9\d{8}$/, 'Ingresa un celular de 9 dígitos que empiece con 9'),
    direccion: z.string().trim().min(5, 'Dirección muy corta').max(200),
    tipo: z.enum(TIPOS),
    motivo: z.enum(MOTIVOS),
    detalles: z.string().trim().min(10, 'Cuéntanos un poco más').max(1000),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida'),
    hora: z.enum(SLOTS),
  })
  .superRefine((d, ctx) => {
    const fecha = new Date(`${d.fecha}T00:00:00Z`);
    if (isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== d.fecha) {
      ctx.addIssue({ code: 'custom', path: ['fecha'], message: 'Fecha inválida' });
      return;
    }
    const min = sumarDias(hoyLima(), 1);
    const max = sumarDias(min, MAX_DAYS_AHEAD);
    if (d.fecha < min || d.fecha > max) {
      ctx.addIssue({ code: 'custom', path: ['fecha'], message: 'Fecha fuera de rango' });
    }
    const dia = fecha.getUTCDay();
    if (DIAS_CERRADOS.includes(dia)) {
      ctx.addIssue({ code: 'custom', path: ['fecha'], message: 'Ese día no atendemos' });
      return;
    }
    if (!HORARIOS_POR_DIA[dia]?.includes(d.hora)) {
      ctx.addIssue({ code: 'custom', path: ['hora'], message: 'Ese horario no está disponible ese día' });
    }
  });

export type Solicitud = z.infer<typeof solicitudSchema>;