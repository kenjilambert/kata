# Kata

Site estático (ES modules nativos, sem bundler — esta máquina não tem Node/npm instalado, então o stack foi ajustado de Vite para HTML/CSS/JS puro; funciona igual em qualquer hospedagem estática).

## Rodar localmente

```
py -m http.server 5501
```

Depois abra `http://localhost:5501`.

Se o navegador insistir em servir arquivos antigos em cache depois de uma edição, troque a porta (em `.claude/launch.json` e no comando acima) — o cache do `http.server` é por origem, então mudar a porta força tudo a vir fresco.

## Estrutura

- `src/core/` — núcleo compartilhado entre módulos: seed (`seed.js`), paletas (`palette.js`), texturas/preenchimentos (`textures.js`), exportação PNG/SVG (`export.js`), empilhamento de camadas (`layer-stack.js`), colar do clipboard (`clipboard-input.js`).
- `src/ui/` — `module-switcher.js` (abas) e `controls/` (slider, select, swatches de cor, botão), reutilizáveis por qualquer módulo.
- `src/modules/` — um módulo por pasta. Hoje só `grid-icons/` (módulo 1: ícones em grade) está implementado.

## Módulo atual: Ícones em grade

Motivos (losango, cruz, xadrez, ponto, círculos concêntricos) distribuídos numa grade, com tema (paleta + subconjunto de motivos), densidade, cores editáveis, seed reproduzível e exportação em PNG/SVG (SVG com grupos nomeados e cores diretas, pronto para colar no Figma/Illustrator).

Para adicionar o próximo módulo do roadmap: criar uma pasta em `src/modules/`, expor um objeto `{ id, label, mount(container), unmount() }` e adicionar ao array em `src/main.js`.
