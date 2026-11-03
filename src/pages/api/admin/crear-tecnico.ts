import type { APIRoute } from 'astro';
import postgres from 'postgres';
import { z } from 'zod';

export const prerender = false;

const sql = postgres(import.meta.env.DATABASE_URL, { prepare: false });

const tecnicoSchema = z.object({
  email: z.string().trim().toLowerCase().email('Correo no válido'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
  nombres: z.string().trim().min(2, 'Ingresa nombres').max(80),
  apellidos: z.string().trim().min(2, 'Ingresa apellidos').max(80),
  telefono: z.string().trim().regex(/^9\d{8}$/, 'Ingresa un celular peruano válido de 9 dígitos (inicia con 9)'),
  especialidad: z.string().trim().min(3, 'Ingresa la especialidad').max(100),
});

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

export const POST: APIRoute = async ({ request, cookies }) => {
  // 1. Validar que quien solicita sea Gerencia (Admin)
  const sessionCookie = cookies.get('yele_session')?.value;
  if (!sessionCookie) {
    return json({ error: 'No autorizado. Debes iniciar sesión como Gerencia.' }, 401);
  }

  try {
    const session = JSON.parse(decodeURIComponent(sessionCookie));
    if (session.role !== 'admin') {
      return json({ error: 'Solo la Gerencia puede dar de alta nuevos técnicos.' }, 403);
    }
  } catch {
    return json({ error: 'Sesión no válida.' }, 401);
  }

  // 2. Parsear datos del técnico
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Formato inválido' }, 400);
  }

  const parsed = tecnicoSchema.safeParse(body);
  if (!parsed.success) {
    const firstErr = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0];
    return json({ error: firstErr || 'Datos incompletos.' }, 400);
  }

  const { email, password, nombres, apellidos, telefono, especialidad } = parsed.data;

  try {
    // 3. Comprobar si el correo ya existe
    const existing = await sql`SELECT id FROM auth.users WHERE email = ${email} LIMIT 1`;
    if (existing.length > 0) {
      return json({ error: 'Ya existe un usuario registrado con este correo.' }, 409);
    }

    // 4. Crear usuario en auth.users
    const [newUser] = await sql`
      INSERT INTO auth.users (
        id,
        instance_id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at,
        confirmation_token
      ) VALUES (
        gen_random_uuid(),
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        ${email},
        crypt(${password}::text, gen_salt('bf', 10)),
        NOW(),
        '{"provider": "email", "providers": ["email"]}'::jsonb,
        json_build_object(
          'role', 'tecnico'::text,
          'nombres', ${nombres}::text,
          'apellidos', ${apellidos}::text,
          'telefono', ${telefono}::text,
          'especialidad', ${especialidad}::text
        ),
        NOW(),
        NOW(),
        ''
      )
      RETURNING id, email
    `;

    // 5. Asegurar rol y especialidad en profiles
    await sql`
      UPDATE public.profiles
      SET role = 'tecnico'::user_role,
          especialidad = ${especialidad},
          telefono = ${telefono}
      WHERE id = ${newUser.id}
    `;

    return json({
      ok: true,
      message: `Técnico ${nombres} ${apellidos} registrado exitosamente.`,
      tecnico: {
        id: newUser.id,
        email: newUser.email,
        nombres,
        apellidos,
        especialidad,
      },
    }, 201);
  } catch (err: any) {
    console.error('Error al registrar técnico:', err);
    return json({ error: 'Error al registrar técnico: ' + err.message }, 500);
  }
};
