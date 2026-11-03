import type { APIRoute } from 'astro';
import postgres from 'postgres';
import { z } from 'zod';

export const prerender = false;

const sql = postgres(import.meta.env.DATABASE_URL, { prepare: false });

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email('Correo electrónico no válido'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
  nombres: z.string().trim().min(2, 'Ingresa tu nombre completo').max(80),
  apellidos: z.string().trim().min(2, 'Ingresa tus apellidos').max(80),
  telefono: z.string().trim().regex(/^9\d{8}$/, 'Ingresa un celular peruano válido de 9 dígitos (inicia con 9)'),
  role: z.enum(['cliente', 'tecnico', 'admin']).default('cliente'),
});

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

export const POST: APIRoute = async ({ request, cookies }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Formato de solicitud no válido.' }, 400);
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    const firstError = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0];
    return json({ error: firstError || 'Datos incompletos.' }, 400);
  }

  const { email, password, nombres, apellidos, telefono, role } = parsed.data;

  try {
    // 1. Verificar si el correo ya existe
    const existing = await sql`
      SELECT id FROM auth.users WHERE email = ${email} LIMIT 1
    `;

    if (existing.length > 0) {
      return json({ error: 'Este correo ya se encuentra registrado. Inicia sesión.' }, 409);
    }

    // 2. Insertar en auth.users con contraseña encriptada (bcrypt) y correo autoconfirmado
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
          'role', ${role}::text,
          'nombres', ${nombres}::text,
          'apellidos', ${apellidos}::text,
          'telefono', ${telefono}::text
        ),
        NOW(),
        NOW(),
        ''
      )
      RETURNING id, email
    `;

    // 3. Confirmar que el trigger creó el perfil o asegurar su existencia
    const [profile] = await sql`
      SELECT id, email, role, nombres, apellidos, telefono FROM public.profiles WHERE id = ${newUser.id}
    `;

    const sessionPayload = {
      id: newUser.id,
      email: newUser.email,
      role: profile?.role || role,
      nombres: profile?.nombres || nombres,
      apellidos: profile?.apellidos || apellidos,
      telefono: profile?.telefono || telefono || '',
    };

    cookies.set('yele_session', JSON.stringify(sessionPayload), {
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
    });

    return json({
      ok: true,
      message: '¡Cuenta creada con éxito! Ya puedes iniciar sesión con tu correo y contraseña.',
      user: sessionPayload,
    }, 201);
  } catch (err: any) {
    console.error('Error en /api/auth/register:', err);
    return json({ error: 'No se pudo crear la cuenta: ' + (err.message || 'Error en servidor') }, 500);
  }
};
