# Halftone Forge Pro Studio

Aplicativo web para criação de halftone, separação de canais, preparação DTF, remoção de fundo, pré-impressão e criação de mockups 3D.

**Aplicativo:** `https://armanioller.github.io/hf/`

## Cópia de segurança antes da atualização profissional

Antes da implantação da suíte profissional, foram congeladas cópias completas dos dois repositórios:

```text
armanioller/hf
└── backup-before-pro-upgrade-2026-08-02

armanioller/hf-data
└── backup-before-pro-upgrade-2026-08-02
```

Essas branches preservam o aplicativo, o Worker, a documentação, o catálogo de modelos e os dados existentes no momento anterior à atualização.

Para restaurar a versão anterior, mova a branch `main` para o commit da branch de backup correspondente. Não apague as branches de backup enquanto a nova versão estiver em validação.

## Recursos principais

- Modos CMYK, RGB, monocromático, duotone e tritone.
- Controle de trama, célula, ganho, ângulos, formas e ajustes tonais.
- Remoção de fundo com seleção, pincel, proteção e formas vetoriais.
- Galeria interna e presets personalizados.
- Exportação PNG, SVG e chapas por canal.
- Preparação DTF com dimensão física, DPI/LPI, base branca e pré-impressão.
- Projetos `.hfp`, recuperação local e biblioteca musical.
- Backup privado em GitHub por meio do Cloudflare Worker.
- Mockup 3D com modelos GLB próprios e biblioteca de modelos padrão.

## Suíte profissional

### Fluxos rápidos

Na tela inicial e no botão **Fluxos**, o usuário escolhe:

1. **Criar halftone** — abre a imagem no editor principal.
2. **Preparar para DTF** — carrega a imagem e avança para a preparação DTF.
3. **Criar mockup 3D** — abre diretamente o Studio 3D.

### Mockup 3D Pro

A barra lateral foi organizada em painéis expansíveis. O navegador lembra quais painéis estavam abertos.

O botão **Editar estampa** adiciona uma camada visual sincronizada aos controles existentes:

- arrastar para mover;
- puxar o canto para redimensionar;
- usar a alça superior para girar;
- usar a roda do mouse para alterar a escala;
- dar duplo clique para centralizar.

A manipulação visual controla a projeção já existente no app. Ela não altera o GLB nem cria UV automaticamente.

### Recuperação da cena 3D

O app mantém uma recuperação automática contendo:

- último modelo lembrado;
- última arte aplicada;
- zona de estampa;
- posição, escala, rotação e filtro de superfície;
- cor e propriedades da peça;
- alterações de materiais;
- iluminação, fundo, exposição e câmera.

O botão **Continuar cena** restaura o último estado disponível.

### Exportação profissional

O botão **Exportar Pro** oferece presets para:

- Mercado Livre;
- Shopee;
- Instagram 4:5;
- Stories 9:16;
- catálogo com quatro ângulos;
- imagem premium em fundo escuro;
- PNG com fundo transparente.

É possível escolher largura, altura e exportar:

- vista atual;
- frente;
- costas;
- manga esquerda;
- manga direita.

Quando mais de um ângulo é selecionado, o app entrega um arquivo ZIP.

A exportação usa o render atual do WebGL e redimensiona a imagem para a dimensão solicitada. O fundo transparente usa remoção automática por cor de recorte; sombras e bordas devem ser conferidas.

## Biblioteca de modelos 3D versão 2

A biblioteca permite:

- pesquisar por nome, descrição ou tag;
- filtrar por categoria;
- marcar favoritos;
- definir um modelo padrão;
- abrir automaticamente o modelo padrão;
- exibir miniatura, categoria, tags e selo de recomendado.

O usuário continua podendo importar seu próprio arquivo pelo botão **Carregar modelo GLB**.

### Administração de modelos

O painel administrativo é aberto por:

```text
https://armanioller.github.io/hf/?admin=armanioller
```

O administrador pode:

- cadastrar modelo;
- substituir o GLB;
- editar nome, descrição, categoria e tags;
- enviar ou substituir a miniatura;
- marcar como recomendado;
- ocultar do público;
- excluir modelo e miniatura.

A chave `ADMIN_KEY` é enviada ao Worker somente no login. O Worker devolve uma sessão assinada com validade de uma hora. A chave não é salva no JavaScript público nem no armazenamento permanente do navegador.

Os arquivos ficam no repositório privado:

```text
models/
├── moletom_003.glb
└── ...
models-thumbs/
├── moletom_003.png
└── ...
models.json
```

## Armazenamento e retenção

Em **Configurações gerais → Armazenamento**, o usuário pode consultar o espaço usado por:

- imagens originais;
- exportações;
- galeria;
- músicas;
- configurações e projetos;
- modelos 3D padrão.

Também é possível limpar categorias e aplicar retenção aos uploads e às exportações:

- manter por 7, 30, 90 ou 180 dias;
- manter somente os últimos 20, 50, 100 ou 250 arquivos.

Os modelos padrão são protegidos e não podem ser apagados pelo painel comum de armazenamento.

## Nuvem e backup

Os controles ficam dentro de **Configurações gerais → Nuvem e backup**.

- **Salvar automaticamente na nuvem** monitora alterações.
- **Salvar agora** executa uma sincronização manual completa.
- **Restaurar da nuvem** recupera galeria, músicas e configurações.

### Cópias automáticas silenciosas

- Imagens carregadas, arrastadas ou coladas são arquivadas em `uploads/`.
- Arquivos gerados pelo app são arquivados em `exports/`.
- O fluxo não mostra toast ou altera o status da interface.
- O limite técnico é de 32 MB por arquivo no módulo cliente.

Estrutura por navegador:

```text
users/<identificador>/
├── uploads/
├── exports/
├── gallery/
├── music/
├── gallery.json
├── music.json
├── preferences.json
├── workspace.json
└── project.hfp
```

Ao limpar os dados locais, usar navegação anônima ou trocar de navegador, um novo identificador pode ser criado.

## Arquitetura

```text
GitHub Pages · hf
        |
        v
Cloudflare Worker
        |
        v
GitHub privado · hf-data
```

O site público não contém o token do GitHub.

## Módulos

```text
index.html
app.html
cloud-public-sync.js
silent-archive.js
ui-fixes.js
model-library.js
src/
├── ui/
│   └── quick-start.js
├── mockup/
│   ├── mockup-pro.js
│   └── model-library-pro.js
└── cloud/
    └── storage-dashboard.js
cloudflare-worker/
└── src/index.js
```

O `app.html` original foi mantido. As novas funções foram adicionadas em módulos separados para facilitar testes, manutenção e reversão.

## Endpoints do Worker

### Públicos

```text
GET  /health
GET  /api/models
GET  /api/model?id=<id>
GET  /api/model-thumb?id=<id>
GET  /api/storage?clientId=<id>
POST /api/storage/clear
POST /api/storage/cleanup
POST /api/save
GET  /api/load
GET  /api/image
GET  /api/audio
```

### Administrativos

```text
POST   /api/admin/login
GET    /api/admin/models
POST   /api/admin/model
DELETE /api/admin/model?id=<id>
```

## Cloudflare Worker

Diretório raiz:

```text
cloudflare-worker
```

Comando de implantação:

```text
npm run deploy
```

Segredos obrigatórios:

```text
GITHUB_TOKEN
ADMIN_KEY
```

O `GITHUB_TOKEN` deve ter acesso somente ao repositório `hf-data`, com permissão **Contents: Read and write**.

## Segurança

O Worker inclui:

- restrição de origem do navegador;
- sessão administrativa assinada por HMAC;
- validade de uma hora para a sessão administrativa;
- limite de tentativas de login;
- limites básicos de requisições e salvamentos;
- validação de identificadores, nomes e tamanhos de arquivos.

Os limites atuais são mantidos na memória de cada instância do Worker. Eles reduzem abusos simples, mas não são um contador global persistente. Para uma implantação pública de grande volume, use Cloudflare Rate Limiting, KV ou Durable Objects.

Nunca coloque `GITHUB_TOKEN` ou `ADMIN_KEY` no HTML, JavaScript público ou repositório.
