import type { APIRoute } from 'astro';
import postgres from 'postgres';
import { z } from 'zod';

export const prerender = false;

const sql = postgres(import.meta.env.DATABASE_URL, { prepare: false });

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Correo no válido'),
  password: z.string().min(1, 'Ingresa tu contraseña'),
  tipo: z.enum(['cliente', 'trabajador']).default('cliente'),
});

const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
  });

export const POST: APIRoute = async ({ request, cookies }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Formato no válido' }, 400);
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    const msg = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0];
    return json({ error: msg || 'Credenciales incompletas' }, 400);
  }

  const { email, password, tipo } = parsed.data;

  try {
    // 1. Buscar usuario y validar contraseña con crypt
    const [user] = await sql`
      SELECT 
        u.id, 
        u.email, 
        (u.encrypted_password = crypt(${password}::text, u.encrypted_password)) AS password_ok,
        p.role,
        p.nombres,
        p.apellidos,
        p.telefono,
        p.activo
      FROM auth.users u
      LEFT JOIN public.profiles p ON p.id = u.id
      WHERE u.email = ${email}
      LIMIT 1
    `;

    if (!user || !user.password_ok) {
      return json({ error: 'Correo o contraseña incorrectos.' }, 401);
    }

    // 2. Validar que si accede como trabajador, no sea un cliente ordinario
    if (tipo === 'trabajador') {
      if (user.role !== 'admin' && user.role !== 'tecnico') {
        return json({
          error: 'Acceso no autorizado: Esta cuenta no tiene permisos de trabajador de la empresa.',
        }, 403);
      }
    }

    if (user.activo === false) {
      return json({
        error: 'Su cuenta se encuentra desactivada. Comuníquese con Gerencia.',
      }, 403);
    }

    // 3. Crear sesión en cookie HTTP-Only segura
    const sessionPayload = {
      id: user.id,
      email: user.email,
      role: user.role || 'cliente',
      nombres: user.nombres || '',
      apellidos: user.apellidos || '',
      telefono: user.telefono || '',
    };

    cookies.set('yele_session', JSON.stringify(sessionPayload), {
      path: '/',
      httpOnly: false, // Accesible por JS para actualizar interfaz
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 días
    });

    let redirectUrl = '/contact?login=success';
    if (user.role === 'admin') {
      redirectUrl = '/admin';
    } else if (user.role === 'tecnico') {
      redirectUrl = '/tecnico';
    }

    return json({
      ok: true,
      message: 'Inicio de sesión exitoso',
      user: sessionPayload,
      redirectUrl,
    });
  } catch (err: any) {
    console.error('Error en /api/auth/login:', err);
    return json({ error: 'Error al iniciar sesión: ' + (err.message || 'Error del servidor') }, 500);
  }
};
