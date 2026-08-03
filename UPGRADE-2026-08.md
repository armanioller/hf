# Atualização profissional · agosto de 2026

## Backup preservado

A versão anterior permanece nas branches:

```text
armanioller/hf: backup-before-pro-upgrade-2026-08-02
armanioller/hf-data: backup-before-pro-upgrade-2026-08-02
```

## Recursos adicionados

- Fluxos rápidos: Halftone, DTF e Mockup 3D.
- Painéis expansíveis em toda a barra lateral do Mockup.
- Manipulação visual da estampa sobre o modelo.
- Recuperação automática da cena 3D.
- Exportação profissional com presets e vários ângulos.
- Biblioteca de modelos com miniaturas, categorias, tags, favoritos e modelo padrão.
- Administração com sessão temporária: cadastrar, editar, substituir, ocultar e excluir modelos.
- Painel de armazenamento, limpeza e retenção.
- Limites básicos de requisições e tentativas administrativas.
- Refatoração modular sem substituir o `app.html` original.

## Checklist de validação

1. Abrir o aplicativo e pressionar `Ctrl + F5`.
2. Conferir os três fluxos na tela sem imagem.
3. Abrir o Mockup 3D e testar os painéis expansíveis.
4. Carregar o Moletom Canguru da biblioteca.
5. Aplicar uma arte e usar **Editar estampa**.
6. Fechar o Mockup, abrir novamente e usar **Continuar cena**.
7. Testar **Exportar Pro** com frente e costas.
8. Abrir Configurações e consultar **Armazenamento**.
9. Abrir `?admin=armanioller`, entrar e editar os dados de um modelo.
10. Confirmar que a biblioteca comum não mostra modelos marcados como ocultos.

## Observações técnicas

- A edição visual sincroniza os sliders de projeção existentes; ela não modifica a malha ou o UV.
- A exportação profissional redimensiona o render WebGL atual.
- A transparência é gerada por remoção automática do fundo de recorte e deve ser conferida.
- Os limites básicos do Worker são mantidos na memória da instância. Para limitação global persistente, usar recursos próprios da Cloudflare.

## Restauração

Caso seja necessário voltar integralmente:

1. No repositório `hf`, mova `main` para o commit apontado por `backup-before-pro-upgrade-2026-08-02`.
2. No repositório `hf-data`, faça o mesmo somente se também for necessário restaurar o catálogo e a estrutura de dados.
3. Aguarde o GitHub Pages e o Cloudflare Worker concluírem as implantações.
4. Limpe o cache com `Ctrl + F5`.
