// View Transitions API (mesmo-documento) — o navegador tira uma "foto" do
// estado ANTES da mudança, deixa quem chamou mexer no DOM à vontade, tira
// outra "foto" do estado DEPOIS, e faz a transição sozinho entre as duas.
// Quando DUAS fotos são do MESMO `view-transition-name`, o navegador
// interpola posição/tamanho/aparência entre elas sozinho — é o que dá o
// efeito de "elemento morfando" (ex.: a pílula ativa do menu deslizando e
// mudando de cor de uma aba pra outra), não precisa animar isso na mão.
//
// IMPORTANTE — por que o nome é sempre TEMPORÁRIO (setado aqui, nunca
// direto no CSS): sem um `view-transition-name` próprio, o elemento cai no
// grupo "root" padrão, que é a PÁGINA INTEIRA — foi o que causou 2
// problemas reais nesta sessão: (1) trocar o FORMATO de um preview fazia a
// página inteira "mexer" junto (sidebar, topbar, tudo), quando só o
// preview deveria se mover; (2) pior, dar um nome FIXO (sempre ligado, via
// CSS estático) a um elemento que cobre a página quase toda promove essa
// região pra uma camada de composição PRÓPRIA o tempo TODO (não só durante
// a transição) — deixa QUALQUER coisa na tela (incluindo o cursor
// seguindo o mouse) lenta, porque o navegador fica sempre pronto pra
// "fotografar" aquele pedaço gigante. A correção: o nome só existe no
// instante da transição, removido assim que ela termina (sucesso OU
// falha, daí o .finally).
//
// `targets` — um {element, name} ou uma lista deles, pra transições com
// mais de uma "peça" morfando ao mesmo tempo (ex.: o conteúdo da aba E o
// indicador de aba ativa, na mesma troca).
export function withViewTransition(updateFn, targets) {
  const supported = Boolean(document.startViewTransition) && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const list = targets ? (Array.isArray(targets) ? targets : [targets]) : [];

  if (!supported) return Promise.resolve(updateFn());

  list.forEach(({ element, name }) => {
    if (element && name) element.style.viewTransitionName = name;
  });
  const transition = document.startViewTransition(updateFn);
  // Um startViewTransition devolve 3 promises (ready/updateCallbackDone/
  // finished); quando uma troca chega em cima da outra rápido demais (ex.:
  // clicar em várias abas seguidas), o navegador CANCELA a transição antiga
  // sozinho (skipTransition) — isso é ESPERADO aqui, não é erro de verdade,
  // só a corrida perdendo pra uma mais nova. Mas em JS, qualquer promise
  // rejeitada sem NENHUM .catch anexado dispara "Uncaught (in promise)"
  // no console, mesmo que ninguém esteja "usando" ela — daí precisar pendurar
  // um .catch vazio nas 3, não só na que a gente efetivamente usa (.finished).
  transition.ready.catch(() => {});
  transition.finished.catch(() => {}).finally(() => {
    list.forEach(({ element, name }) => {
      if (element && name) element.style.viewTransitionName = '';
    });
  });
  transition.updateCallbackDone.catch(() => {});
  // `updateCallbackDone` (devolvida pra quem chamou, ver module-switcher.js)
  // só rejeita se o PRÓPRIO updateFn der erro de verdade — não é abortada
  // pelo "skipped" (isso só afeta finished/ready) — então aqui não precisa
  // de .catch nenhum, o erro real continua propagando normalmente pra quem
  // chamou tratar.
  return transition.updateCallbackDone;
}
