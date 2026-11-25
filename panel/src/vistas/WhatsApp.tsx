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

type EstadoWa = {
  estado: string;
  qrPendiente: boolean;
  emparejamiento: { codigo: string } | { error: string } | null;
};

export function WhatsApp({ base }: { base: string }) {
  const wa = useDatos<EstadoWa>(`${base}/whatsapp`, 3000);
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
      {wa.datos && wa.datos.estado !== 'open' && <Vincular base={base} wa={wa.datos} />}
      {empresa.datos && <Filtro base={base} empresa={empresa.datos} alGuardar={empresa.recargar} />}
      {empresa.datos && <PausaAutomatica base={base} activa={empresa.datos.pausaAutomatica} alGuardar={empresa.recargar} />}
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
      {modo === 'SOLO_LISTA' && !empresa.filtroNumeros.length && (
        <p className="alerta-caja">La lista está vacía: el asistente no le está respondiendo a nadie. Agrega al menos un número y guarda.</p>
      )}
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

function Vincular({ base, wa }: { base: string; wa: EstadoWa }) {
  const [numero, setNumero] = useState('');
  const [pidiendo, setPidiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const e = wa.emparejamiento;

  // La respuesta del gateway llega por el sondeo del estado.
  useEffect(() => {
    if (e) setPidiendo(false);
  }, [e]);

  const pedir = async () => {
    setError(null);
    setAviso(null);
    try {
      await api.post(`${base}/whatsapp/codigo`, { numero });
      setPidiendo(true);
    } catch (x) {
      setError((x as Error).message);
    }
  };

  const reiniciar = async () => {
    if (!confirm('Se borra la vinculación a medias y se genera un QR nuevo. ¿Seguir?')) return;
    setError(null);
    try {
      await api.post(`${base}/whatsapp/reiniciar`);
      setAviso('Reiniciado. En unos segundos aparece un QR nuevo.');
    } catch (x) {
      setError((x as Error).message);
    }
  };

  return (
    <div className="tarjeta">
      <h3>¿El QR no funciona? Vincula con código</h3>
      <p className="tenue">
        En el teléfono del asistente: WhatsApp → Dispositivos vinculados → Vincular dispositivo → "Vincular con número de
        teléfono", y escribe el código que aparece aquí.
      </p>
      <label>
        Número del WhatsApp del asistente (con código de país, por ejemplo 50499998888)
        <input inputMode="numeric" value={numero} onChange={(x) => setNumero(x.target.value)} />
      </label>
      <div className="botones">
        <button onClick={pedir} disabled={pidiendo || numero.replace(/\D/g, '').length < 8}>
          {pidiendo ? 'Pidiendo código…' : 'Pedir código'}
        </button>
        <button className="secundario" onClick={reiniciar}>
          Reiniciar vinculación
        </button>
      </div>
      {e && 'codigo' in e && (
        <p className="codigo">
          {e.codigo.slice(0, 4)}-{e.codigo.slice(4)}
        </p>
      )}
      {e && 'error' in e && <p className="error">{e.error}</p>}
      <Aviso error={error} />
      {aviso && <p className="ok">{aviso}</p>}
    </div>
  );
}

function PausaAutomatica({ base, activa, alGuardar }: { base: string; activa: boolean; alGuardar: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const cambiar = async (valor: boolean) => {
    setError(null);
    try {
      await api.put(`${base}/pausa-automatica`, { activa: valor });
      alGuardar();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="tarjeta">
      <h3>Pausa automática</h3>
      <label className="opcion">
        <input type="checkbox" checked={activa} onChange={(e) => cambiar(e.target.checked)} /> Pausar el bot en un chat
        cuando alguien escribe a mano desde el WhatsApp del asistente
      </label>
      <p className="tenue">
        Apágala mientras pruebas desde el mismo teléfono o WhatsApp Web del asistente. Con la pausa apagada, /pausa sigue
        funcionando para pausar un chat a mano.
      </p>
      <Aviso error={error} />
    </div>
  );
}
