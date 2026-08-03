# Halftone Forge Pro Studio

Aplicativo web para criação de halftone, separação de canais, preparação de artes para impressão, remoção de fundo, montagem DTF, pré-impressão e mockup 3D.

**Aplicativo:** `https://armanioller.github.io/hf/`

## Recursos principais

- Modos CMYK, RGB, monocromático, duotone e tritone.
- Controle de trama, célula, ganho, ângulos, forma dos pontos e ajustes tonais.
- Remoção de fundo com seleção, pincel, proteção, caneta vetorial e histórico.
- Galeria interna de imagens.
- Presets rápidos e presets personalizados.
- Exportação PNG, SVG e chapas por canal.
- Preparação DTF com tamanho físico, DPI/LPI, base branca e verificação pré-impressão.
- Projeto `.hfp`, recuperação local e biblioteca musical.
- Mockup 3D com modelos GLB.

## Nuvem e backup

Os controles de nuvem ficam dentro de **Configurações gerais → Nuvem e backup**. Não existe barra fixa sobre a área de trabalho.

### Salvar automaticamente na nuvem

Quando ativado, o app monitora alterações e envia os dados depois de um curto período sem novas mudanças. A opção pode ser desligada; nesse caso, nenhum salvamento automático é feito.

### Salvar agora

O botão **Salvar agora** executa uma sincronização manual completa, mesmo quando o salvamento automático está desligado.

### Restaurar da nuvem

O botão **Restaurar da nuvem** substitui os dados locais pelos dados salvos para o identificador atual do navegador.

### Cópias automáticas silenciosas

- Ao carregar, arrastar ou colar uma imagem, o arquivo original é arquivado em `uploads/`.
- Ao exportar ou baixar um arquivo pelo app, uma cópia idêntica é arquivada em `exports/`.
- Essas cópias acontecem em segundo plano, sem toast, aviso ou mudança no status da interface.
- Elas funcionam mesmo quando a opção geral **Salvar automaticamente na nuvem** está desligada.
- O limite técnico é de 32 MB por arquivo; arquivos maiores continuam funcionando localmente, mas não recebem a cópia remota.

### Dados sincronizados

- imagens originais carregadas, arrastadas ou coladas;
- arquivos exportados ou baixados pelo app;
- imagens e metadados da galeria;
- músicas importadas;
- preferências da interface e do player;
- parâmetros e configurações atuais do aplicativo;
- estado de trabalho compatível com o projeto do Halftone Forge.

## Arquitetura da nuvem

O site público não contém token do GitHub e não pede que visitantes conectem uma conta.

```text
GitHub Pages (hf)
        |
        v
Cloudflare Worker
        |
        v
Repositório privado hf-data
```

A credencial do GitHub fica armazenada como o segredo `GITHUB_TOKEN` no Cloudflare Worker. O Worker aceita requisições apenas da origem configurada do GitHub Pages.

Cada navegador recebe um identificador anônimo salvo em `localStorage`. Os dados são gravados no repositório privado nesta estrutura:

```text
users/<identificador>/
├── uploads/
├── exports/
├── gallery/
├── music/
├── gallery.json
├── music.json
├── preferences.json
└── workspace.json
```

### Limitação importante

Ao limpar os dados do navegador, usar modo anônimo ou trocar de navegador, um novo identificador pode ser criado. Os arquivos antigos continuam no repositório, mas não são restaurados automaticamente para o novo identificador.

## Arquivos de implantação

- `index.html`: contêiner público que carrega o aplicativo.
- `app.html`: aplicativo principal.
- `cloud-public-sync.js`: sincronização, controles em Configurações e documentação dinâmica.
- `silent-archive.js`: cópias silenciosas dos arquivos carregados e exportados.
- `gallery-memory-bridge.js`: ponte para galerias grandes mantidas em memória.
- `cloudflare-worker/`: API protegida responsável por acessar o repositório privado.

## Cloudflare Worker

Diretório raiz da implantação:

```text
cloudflare-worker
```

Comando de implantação:

```text
npm run deploy
```

Segredo obrigatório:

```text
GITHUB_TOKEN
```

O token deve ter acesso somente ao repositório `hf-data`, com permissão **Contents: Read and write**.

## Segurança

- Nunca coloque o token no `index.html`, `app.html` ou JavaScript público.
- Nunca faça commit do token no GitHub.
- Restrinja o token ao repositório privado de dados.
- Mantenha a origem permitida do Worker limitada a `https://armanioller.github.io`.
- Revogue e substitua o token imediatamente caso ele seja exposto.
