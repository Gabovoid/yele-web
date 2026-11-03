-- ==============================================================================
-- SISTEMA DE MANTENIMIENTO INTEGRAL - YELE S.A.C.
-- Esquema Completo de Base de Datos para Supabase (PostgreSQL + RLS + Triggers)
-- ==============================================================================

-- 1. Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Tipo Enum para Roles de Usuario
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('cliente', 'tecnico', 'admin');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. Tabla de Perfiles (Extensión de auth.users de Supabase)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'cliente',
    nombres TEXT,
    apellidos TEXT,
    telefono TEXT,
    especialidad TEXT, -- Aplica para técnicos: 'Electricidad', 'HVAC', 'Plomería', etc.
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Habilitar RLS en profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 4. Función y Trigger para sincronizar automáticamente auth.users con public.profiles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    assigned_role user_role;
    user_names TEXT;
    user_lastnames TEXT;
BEGIN
    -- Si en la metadata viene un rol explícito (ej: creado desde panel de gerencia), se usa ese.
    -- Para usuarios de registro público o Google OAuth, por defecto siempre es 'cliente'.
    assigned_role := COALESCE((new.raw_user_meta_data->>'role')::user_role, 'cliente');
    
    user_names := COALESCE(new.raw_user_meta_data->>'nombres', new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1));
    user_lastnames := COALESCE(new.raw_user_meta_data->>'apellidos', '');

    INSERT INTO public.profiles (id, email, role, nombres, apellidos, telefono, especialidad)
    VALUES (
        new.id,
        new.email,
        assigned_role,
        user_names,
        user_lastnames,
        new.raw_user_meta_data->>'telefono',
        new.raw_user_meta_data->>'especialidad'
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        updated_at = NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Disparador después de la creación en auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 5. Tabla de Solicitudes / Citas de Visita Técnica
-- (Compatible y mejorada con la tabla 'solicitudes' ya existente)
CREATE TABLE IF NOT EXISTS public.solicitudes (
    id BIGSERIAL PRIMARY KEY,
    cliente_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    tecnico_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    nombres VARCHAR(80) NOT NULL,
    apellidos VARCHAR(80) NOT NULL,
    correo VARCHAR(150) NOT NULL,
    telefono VARCHAR(20) NOT NULL,
    direccion VARCHAR(200) NOT NULL,
    referencia TEXT,
    tipo VARCHAR(80) NOT NULL,
    motivo VARCHAR(80) NOT NULL,
    detalles TEXT NOT NULL,
    fecha DATE NOT NULL,
    hora VARCHAR(20) NOT NULL,
    estado VARCHAR(30) NOT NULL DEFAULT 'pendiente',
    -- Estados: 'pendiente', 'asignada', 'en_camino', 'en_sitio', 'informe_enviado', 'cotizada', 'aprobada', 'rechazada', 'completada', 'cancelada'
    correo_enviado BOOLEAN NOT NULL DEFAULT FALSE,
    assigned_at TIMESTAMPTZ,
    attended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Si la tabla ya existía, aseguramos que tenga las columnas nuevas y el constraint de estado ampliado
DO $$ BEGIN
    ALTER TABLE public.solicitudes ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
    ALTER TABLE public.solicitudes ADD COLUMN IF NOT EXISTS tecnico_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
    ALTER TABLE public.solicitudes ADD COLUMN IF NOT EXISTS referencia TEXT;
    ALTER TABLE public.solicitudes ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
    ALTER TABLE public.solicitudes ADD COLUMN IF NOT EXISTS attended_at TIMESTAMPTZ;
    
    ALTER TABLE public.solicitudes ALTER COLUMN estado TYPE VARCHAR(50);
    ALTER TABLE public.solicitudes ALTER COLUMN telefono TYPE VARCHAR(20);
    ALTER TABLE public.solicitudes ALTER COLUMN tipo TYPE VARCHAR(100);
    ALTER TABLE public.solicitudes ALTER COLUMN motivo TYPE VARCHAR(100);

    ALTER TABLE public.solicitudes DROP CONSTRAINT IF EXISTS solicitudes_estado_check;
    ALTER TABLE public.solicitudes ADD CONSTRAINT solicitudes_estado_check 
        CHECK (estado IN ('pendiente', 'asignada', 'en_camino', 'en_sitio', 'informe_enviado', 'cotizada', 'aprobada', 'rechazada', 'completada', 'cancelada'));
EXCEPTION
    WHEN others THEN null;
END $$;

ALTER TABLE public.solicitudes ENABLE ROW LEVEL SECURITY;

-- 6. Tabla de Informes Técnicos de Campo (Llenado por los técnicos al terminar la visita)
CREATE TABLE IF NOT EXISTS public.informes_tecnicos (
    id BIGSERIAL PRIMARY KEY,
    solicitud_id BIGINT NOT NULL REFERENCES public.solicitudes(id) ON DELETE CASCADE,
    tecnico_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    diagnostico TEXT NOT NULL,
    trabajo_sugerido TEXT NOT NULL,
    materiales_requeridos JSONB NOT NULL DEFAULT '[]'::jsonb, 
    -- Estructura de ejemplo en JSONB: [{"item": "Disyuntor termomagnético 32A", "cantidad": 2, "unidad": "und", "codigo_ref": "MAT-01"}]
    horas_estimadas NUMERIC(5,2) NOT NULL DEFAULT 1.0,
    nivel_prioridad VARCHAR(20) NOT NULL DEFAULT 'media', -- 'baja', 'media', 'alta', 'critica'
    fotos_evidencia TEXT[] NOT NULL DEFAULT '{}', -- URLs de fotos subidas al bucket de Supabase Storage
    observaciones TEXT,
    firma_cliente_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.informes_tecnicos ENABLE ROW LEVEL SECURITY;

-- 7. Catálogo Referencial de Materiales y Tarifas (Base para pre-cotizar inteligentemente)
CREATE TABLE IF NOT EXISTS public.catalogo_precios (
    id BIGSERIAL PRIMARY KEY,
    codigo VARCHAR(50) UNIQUE NOT NULL,
    nombre VARCHAR(200) NOT NULL,
    categoria VARCHAR(50) NOT NULL DEFAULT 'general', -- 'electricidad', 'redes', 'climatizacion', 'plomeria', 'obras'
    tipo VARCHAR(20) NOT NULL DEFAULT 'material', -- 'material', 'mano_de_obra', 'servicio_estandar', 'transporte'
    unidad VARCHAR(20) NOT NULL DEFAULT 'und', -- 'und', 'metro', 'hora', 'global'
    costo_referencial NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    precio_venta_sugerido NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.catalogo_precios ENABLE ROW LEVEL SECURITY;

-- 8. Tabla de Cotizaciones Formales (Generadas por Gerencia para enviar al Cliente)
CREATE TABLE IF NOT EXISTS public.cotizaciones (
    id BIGSERIAL PRIMARY KEY,
    codigo_cotizacion VARCHAR(50) UNIQUE NOT NULL, -- ej: COT-2026-0001
    solicitud_id BIGINT NOT NULL REFERENCES public.solicitudes(id) ON DELETE CASCADE,
    informe_id BIGINT REFERENCES public.informes_tecnicos(id) ON DELETE SET NULL,
    gerente_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    subtotal_materiales NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    subtotal_mano_obra NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    gastos_operativos NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    descuento NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    igv NUMERIC(10,2) NOT NULL DEFAULT 0.00, -- 18% si aplica
    total NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    moneda VARCHAR(5) NOT NULL DEFAULT 'PEN', -- 'PEN' (Soles) o 'USD' (Dólares)
    dias_validez INTEGER NOT NULL DEFAULT 15,
    tiempo_estimado_entrega VARCHAR(100) DEFAULT '2 a 3 días hábiles tras aprobación',
    condiciones_pago TEXT DEFAULT '50% adelanto y 50% al finalizar los trabajos a entera conformidad.',
    estado VARCHAR(30) NOT NULL DEFAULT 'borrador', -- 'borrador', 'enviada', 'aceptada', 'rechazada', 'vencida'
    observaciones_gerencia TEXT,
    fecha_emision TIMESTAMPTZ,
    fecha_respuesta_cliente TIMESTAMPTZ,
    motivo_rechazo TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.cotizaciones ENABLE ROW LEVEL SECURITY;

-- 9. Detalles / Partidas de la Cotización
CREATE TABLE IF NOT EXISTS public.cotizacion_items (
    id BIGSERIAL PRIMARY KEY,
    cotizacion_id BIGINT NOT NULL REFERENCES public.cotizaciones(id) ON DELETE CASCADE,
    tipo VARCHAR(20) NOT NULL DEFAULT 'servicio', -- 'material', 'mano_de_obra', 'servicio', 'viatico'
    descripcion TEXT NOT NULL,
    cantidad NUMERIC(10,2) NOT NULL DEFAULT 1.0,
    unidad VARCHAR(20) NOT NULL DEFAULT 'und',
    precio_unitario NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    subtotal NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.cotizacion_items ENABLE ROW LEVEL SECURITY;

-- ==============================================================================
-- 10. POLÍTICAS DE SEGURIDAD (Row Level Security - RLS)
-- ==============================================================================

-- Función auxiliar para obtener el rol del usuario autenticado
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS user_role AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- === PERFILES (profiles) ===
CREATE POLICY "Los usuarios pueden ver su propio perfil"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id OR public.current_user_role() = 'admin');

CREATE POLICY "Los usuarios pueden actualizar su propio perfil"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id OR public.current_user_role() = 'admin');

CREATE POLICY "Gerencia puede gestionar todos los perfiles"
    ON public.profiles FOR ALL
    USING (public.current_user_role() = 'admin');

-- === SOLICITUDES (solicitudes) ===
-- Clientes pueden crear solicitudes públicas o vinculadas
CREATE POLICY "Cualquiera puede crear una solicitud"
    ON public.solicitudes FOR INSERT
    WITH CHECK (true);

-- Clientes ven sus solicitudes (por auth.uid() o coincidencia de correo)
CREATE POLICY "Clientes ven sus propias solicitudes"
    ON public.solicitudes FOR SELECT
    USING (
        auth.uid() = cliente_id 
        OR (auth.email() IS NOT NULL AND correo = auth.email())
        OR public.current_user_role() = 'admin'
    );

-- Técnicos ven las solicitudes que les han sido asignadas
CREATE POLICY "Técnicos ven solicitudes asignadas"
    ON public.solicitudes FOR SELECT
    USING (
        auth.uid() = tecnico_id 
        OR public.current_user_role() = 'admin'
    );

-- Técnicos pueden actualizar el estado de su cita asignada
CREATE POLICY "Técnicos actualizan estado de sus citas"
    ON public.solicitudes FOR UPDATE
    USING (auth.uid() = tecnico_id OR public.current_user_role() = 'admin');

-- Gerencia tiene acceso total a solicitudes
CREATE POLICY "Gerencia gestiona todas las solicitudes"
    ON public.solicitudes FOR ALL
    USING (public.current_user_role() = 'admin');

-- === INFORMES TÉCNICOS (informes_tecnicos) ===
CREATE POLICY "Técnicos crean sus propios informes"
    ON public.informes_tecnicos FOR INSERT
    WITH CHECK (auth.uid() = tecnico_id OR public.current_user_role() = 'admin');

CREATE POLICY "Técnicos y gerencia leen informes"
    ON public.informes_tecnicos FOR SELECT
    USING (
        auth.uid() = tecnico_id 
        OR public.current_user_role() = 'admin'
        -- El cliente también puede leer el informe si está cotizado y aprobado para su vista:
        OR EXISTS (
            SELECT 1 FROM public.solicitudes s 
            WHERE s.id = informes_tecnicos.solicitud_id 
            AND (s.cliente_id = auth.uid() OR s.correo = auth.email())
        )
    );

CREATE POLICY "Gerencia gestiona informes"
    ON public.informes_tecnicos FOR ALL
    USING (public.current_user_role() = 'admin');

-- === CATÁLOGO DE PRECIOS ===
CREATE POLICY "Lectura pública/autenticada del catálogo"
    ON public.catalogo_precios FOR SELECT
    USING (true);

CREATE POLICY "Solo gerencia modifica el catálogo"
    ON public.catalogo_precios FOR ALL
    USING (public.current_user_role() = 'admin');

-- === COTIZACIONES Y SUS ITEMS ===
CREATE POLICY "Gerencia gestiona cotizaciones"
    ON public.cotizaciones FOR ALL
    USING (public.current_user_role() = 'admin');

CREATE POLICY "Clientes ven sus cotizaciones emitidas"
    ON public.cotizaciones FOR SELECT
    USING (
        public.current_user_role() = 'admin'
        OR (
            estado IN ('enviada', 'aceptada', 'rechazada')
            AND EXISTS (
                SELECT 1 FROM public.solicitudes s
                WHERE s.id = cotizaciones.solicitud_id
                AND (s.cliente_id = auth.uid() OR s.correo = auth.email())
            )
        )
    );

CREATE POLICY "Clientes pueden aceptar o rechazar su cotización"
    ON public.cotizaciones FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.solicitudes s
            WHERE s.id = cotizaciones.solicitud_id
            AND (s.cliente_id = auth.uid() OR s.correo = auth.email())
        )
    )
    WITH CHECK (
        estado IN ('aceptada', 'rechazada')
    );

CREATE POLICY "Gerencia e interesados leen items de cotización"
    ON public.cotizacion_items FOR SELECT
    USING (
        public.current_user_role() = 'admin'
        OR EXISTS (
            SELECT 1 FROM public.cotizaciones c
            WHERE c.id = cotizacion_items.cotizacion_id
            AND c.estado IN ('enviada', 'aceptada', 'rechazada')
        )
    );

CREATE POLICY "Solo gerencia edita items de cotización"
    ON public.cotizacion_items FOR ALL
    USING (public.current_user_role() = 'admin');

-- ==============================================================================
-- 11. BUCKET DE SUPABASE STORAGE (Para fotos de informes y evidencias)
-- ==============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('evidencias-informes', 'evidencias-informes', true)
ON CONFLICT (id) DO NOTHING;

-- Políticas de storage
CREATE POLICY "Permitir subida de evidencias a técnicos y admin"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'evidencias-informes' 
        AND auth.role() = 'authenticated'
    );

CREATE POLICY "Permitir lectura de evidencias"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'evidencias-informes');

-- ==============================================================================
-- 12. DATOS SEMILLA BÁSICOS (Catálogo Inicial)
-- ==============================================================================
INSERT INTO public.catalogo_precios (codigo, nombre, categoria, tipo, unidad, costo_referencial, precio_venta_sugerido)
VALUES 
    ('ELE-001', 'Visita Técnica de Diagnóstico Eléctrico', 'electricidad', 'servicio_estandar', 'servicio', 30.00, 60.00),
    ('ELE-002', 'Hora Hombre Técnico Electricista Calificado', 'electricidad', 'mano_de_obra', 'hora', 35.00, 70.00),
    ('ELE-003', 'Interruptor Termomagnético 2x20A - 2x32A Bticino/Schneider', 'electricidad', 'material', 'und', 32.00, 55.00),
    ('ELE-004', 'Interruptor Diferencial 2x25A 30mA', 'electricidad', 'material', 'und', 65.00, 110.00),
    ('ELE-005', 'Cable Mellizo / Cable Indeco THW 14 AWG (Metro)', 'electricidad', 'material', 'metro', 2.20, 4.50),
    ('GEN-001', 'Movilidad y Viáticos Técnicos (Lima Metropolitana)', 'general', 'transporte', 'global', 20.00, 35.00)
ON CONFLICT (codigo) DO NOTHING;


-- ==============================================================================
-- 13. BANDEJA DE ENTRADA, MENSAJERÍA Y NOTIFICACIONES
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.mensajes (
    id BIGSERIAL PRIMARY KEY,
    solicitud_id BIGINT NOT NULL REFERENCES public.solicitudes(id) ON DELETE CASCADE,
    remitente_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    remitente_rol VARCHAR(20) NOT NULL, -- 'gerencia', 'cliente', 'tecnico'
    mensaje TEXT NOT NULL,
    leido BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.mensajes ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.notificaciones (
    id BIGSERIAL PRIMARY KEY,
    usuario_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    solicitud_id BIGINT REFERENCES public.solicitudes(id) ON DELETE CASCADE,
    titulo VARCHAR(150) NOT NULL,
    mensaje TEXT NOT NULL,
    tipo VARCHAR(30) NOT NULL DEFAULT 'info', -- 'estado_cita', 'cotizacion_lista', 'mensaje_nuevo'
    leida BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.notificaciones ENABLE ROW LEVEL SECURITY;
