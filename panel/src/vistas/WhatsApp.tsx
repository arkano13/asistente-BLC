import { useEffect, useState } from 'react';
import { api, type Empresa } from '../api';
import { Aviso, useDatos } from '../util';

const ESTADOS: Record<string, string> = {
  open: 'Conectado',
  connecting: 'Conectando…',
  close: 'Desconectado',
  desconocido: 'Sin datos del gateway',
};

const MODOS = [
  { id: 'TODOS', texto: 'Responder a todos' },
  { id: 'SOLO_LISTA', texto: 'Responder solo a los números de la lista (modo prueba)' },
  { id: 'EXCLUIR_LISTA', texto: 'Responder a todos menos a los de la lista' },
] as const;

export function WhatsApp({ base }: { base: string }) {
  const wa = useDatos<{ estado: string; qrPendiente: boolean }>(`${base}/whatsapp`, 3000);
  const empresa = useDatos<Empresa>(base);
  const [qr, setQr] = useState<string | null>(null);

  // El QR rota cada ~20 s: se vuelve a pedir mientras esté pendiente.
  useEffect(() => {
    if (!wa.datos?.qrPendiente) {
      setQr(null);
      return;
    }
    let vivo = true;
    fetch(`${base}/qr.png`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => vivo && setQr(b ? URL.createObjectURL(b) : null));
    return () => {
      vivo = false;
    };
  }, [wa.datos, base]);

  return (
    <section>
      <h2>WhatsApp</h2>
      <div className="tarjeta">
        <p>
          Estado: <strong>{ESTADOS[wa.datos?.estado ?? 'desconocido'] ?? wa.datos?.estado}</strong>
        </p>
        {qr ? (
          <>
            <p>En el teléfono del asistente: WhatsApp → Dispositivos vinculados → Vincular dispositivo, y escanea:</p>
            <img className="qr" src={qr} alt="Código QR para vincular WhatsApp" />
          </>
        ) : (
          wa.datos?.estado !== 'open' && <p className="tenue">Esperando el código QR del gateway…</p>
        )}
        <Aviso error={wa.error} />
      </div>
      {empresa.datos && <Filtro base={base} empresa={empresa.datos} alGuardar={empresa.recargar} />}
    </section>
  );
}

function Filtro({ base, empresa, alGuardar }: { base: string; empresa: Empresa; alGuardar: () => void }) {
  const [modo, setModo] = useState(empresa.filtroModo);
  const [texto, setTexto] = useState(empresa.filtroNumeros.join('\n'));
  const [estado, setEstado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const guardar = async () => {
    setError(null);
    try {
      const numeros = texto.split(/[\n,;]+/).map((n) => n.trim()).filter(Boolean);
      const r = await api.put<{ filtroNumeros: string[] }>(`${base}/filtro`, { modo, numeros });
      setTexto(r.filtroNumeros.join('\n'));
      setEstado('Guardado. Se aplica a los próximos mensajes.');
      alGuardar();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="tarjeta">
      <h3>¿A quién responde el asistente?</h3>
      {MODOS.map((m) => (
        <label key={m.id} className="opcion">
          <input type="radio" name="modo" checked={modo === m.id} onChange={() => setModo(m.id)} /> {m.texto}
        </label>
      ))}
      {modo !== 'TODOS' && (
        <label>
          Números (uno por línea, con código de país, por ejemplo 50499998888)
          <textarea rows={6} value={texto} onChange={(e) => setTexto(e.target.value)} />
        </label>
      )}
      <p className="tenue">
        Los mensajes de números fuera del filtro no se tocan: el bot no los lee ni los guarda, y el chat queda como si el
        asistente no existiera.
      </p>
      <Aviso error={error} />
      {estado && <p className="ok">{estado}</p>}
      <button onClick={guardar}>Guardar filtro</button>
    </div>
  );
}
