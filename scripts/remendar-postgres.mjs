// Remendo do postgres.js 3.4.9 (o mais novo no npm e o master do porsager em 2026-10-08): uma consulta mandada a uma
// conexão que já fechou derruba o PROCESSO. Roda no postinstall (local, CI, app do Mac) e no Dockerfile (que instala com
// --ignore-scripts). Idempotente; falha alto se o texto mudou numa versão nova, para alguém olhar de novo.
//
// O defeito, medido em 2026-10-08 (queda do Docker no Nod diário, reproduzido com um proxy TCP): a conexão cai com um
// `sql.begin` em voo. `closed()` zera o socket e rejeita a consulta; o `begin` então manda `ROLLBACK` direto na MESMA
// conexão (`c.execute`, sem passar pela fila do pool); `write()` agenda `nextWrite` num setImmediate, e `nextWrite` faz
// `socket.write` com socket null → TypeError fora de qualquer promessa → uncaughtException → a API morre. Com FIN ou com
// RST, nas duas.
//
// O remendo: `execute` numa conexão sem socket rejeita a consulta com CONNECTION_CLOSED (o mesmo erro que o `closed()` dá
// às que estavam em voo), e `nextWrite` sem socket larga o pedaço e rejeita as pendentes em vez de lançar. O pool segue: a
// próxima consulta abre conexão nova, como já fazia.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MARCA = "nod:remendo-socket-nulo";
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARQUIVOS = ["src", "cjs/src", "cf/src"].map((d) => join(RAIZ, "node_modules", "postgres", d, "connection.js"));

const TROCAS = [
  {
    antes: `  function execute(q) {
    if (terminated)
      return queryError(q, Errors.connection('CONNECTION_DESTROYED', options))
`,
    depois: `  function execute(q) {
    if (terminated)
      return queryError(q, Errors.connection('CONNECTION_DESTROYED', options))

    if (!socket) // ${MARCA}: conexão já fechada (ex.: o ROLLBACK do begin depois da queda)
      return queryError(q, Errors.connection('CONNECTION_CLOSED', options))
`,
  },
  {
    antes: `  function nextWrite(fn) {
    const x = socket.write(chunk, fn)
`,
    depois: `  function nextWrite(fn) {
    if (!socket) { // ${MARCA}: o socket fechou entre o write e o setImmediate
      nextWriteTimer !== null && clearImmediate(nextWriteTimer)
      chunk = nextWriteTimer = null
      error(Errors.connection('CONNECTION_CLOSED', options))
      return false
    }
    const x = socket.write(chunk, fn)
`,
  },
];

/** Aplica o remendo nos três builds; devolve quantos arquivos mudaram. Lança se algum não casa com o texto esperado. */
export function remendar(arquivos = ARQUIVOS) {
  let mudados = 0;
  for (const arquivo of arquivos) {
    const original = readFileSync(arquivo, "utf8");
    if (original.includes(MARCA)) continue;
    let texto = original;
    for (const { antes, depois } of TROCAS) {
      if (!texto.includes(antes)) {
        throw new Error(`remendar-postgres: ${arquivo} não tem o trecho esperado; o postgres.js mudou — reveja o remendo (scripts/remendar-postgres.mjs)`);
      }
      texto = texto.replace(antes, depois);
    }
    writeFileSync(arquivo, texto);
    mudados++;
  }
  return mudados;
}

/** true quando os três builds já têm o remendo (o teste de regressão confere antes de derrubar a conexão). */
export function remendado(arquivos = ARQUIVOS) {
  return arquivos.every((arquivo) => readFileSync(arquivo, "utf8").includes(MARCA));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  remendar();
}
