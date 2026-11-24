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
      <form className="tarjeta" onSubmit={enviar}>
        <h1>Asistente BLC</h1>
        <p className="tenue">{primero ? 'Crea el primer usuario administrador.' : 'Entra al panel.'}</p>
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
  );
}
