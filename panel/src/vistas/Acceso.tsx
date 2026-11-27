import { useState, type FormEvent } from 'react';
import { api, type Sesion } from '../api';
import { Aviso } from '../util';

/** Login. "Primer acceso" crea el primer usuario de la empresa con la ADMIN_API_KEY (solo funciona una vez). */
export function Acceso({ alEntrar }: { alEntrar: (s: Sesion) => void }) {
  const [primero, setPrimero] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setEnviando(true);
    setError(null);
    try {
      const s = primero
        ? await api.post<Sesion>(
            '/auth/primer-admin',
            { empresaId: f.empresaId, nombre: f.nombre, email: f.email, password: f.password },
            { 'x-api-key': f.clave },
          )
        : await api.post<Sesion>('/auth/login', { email: f.email, password: f.password });
      alEntrar(s);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="acceso">
      <section className="acceso-marca">
        <img className="logo" src="/logo-blc-blanco.png" alt="BLC Building Leaders Company" />
        <div>
          <p className="kicker">Panel del asistente</p>
          <h1>Fortalecemos líderes. Transformamos organizaciones.</h1>
          <p className="lema">Aquí el equipo sigue las conversaciones del asistente de WhatsApp, atiende los escalamientos y mantiene al día lo que el asistente sabe.</p>
        </div>
        <p className="acceso-pie">Building Leaders Company · Construimos legados.</p>
      </section>
      <div className="acceso-form">
      <form onSubmit={enviar}>
        <h2>{primero ? 'Primer acceso' : 'Entrar'}</h2>
        <p className="tenue">{primero ? 'Crea el primer usuario administrador.' : 'Usa tu usuario del equipo BLC.'}</p>
        {primero && (
          <>
            <label>
              Empresa
              <input name="empresaId" defaultValue="blc" required />
            </label>
            <label>
              Clave de administración (ADMIN_API_KEY)
              <input name="clave" type="password" required autoComplete="off" />
            </label>
            <label>
              Tu nombre
              <input name="nombre" required />
            </label>
          </>
        )}
        <label>
          Email
          <input name="email" type="email" required autoComplete="username" />
        </label>
        <label>
          Contraseña {primero && <span className="tenue">(mínimo 10 caracteres)</span>}
          <input name="password" type="password" required minLength={primero ? 10 : 1} autoComplete={primero ? 'new-password' : 'current-password'} />
        </label>
        <Aviso error={error} />
        <button disabled={enviando}>{primero ? 'Crear y entrar' : 'Entrar'}</button>
        <button type="button" className="enlace" onClick={() => setPrimero((v) => !v)}>
          {primero ? 'Ya tengo usuario' : 'Primer acceso'}
        </button>
      </form>
      </div>
    </div>
  );
}
